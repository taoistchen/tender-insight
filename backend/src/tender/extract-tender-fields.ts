import { createRequire } from "node:module";
import type { QualificationRequirement, TenderNotice } from "../domain/types.js";
import { extractTenderFromPage, escapeNonHtml } from "../analysis/ai-extract.js";
import { MAX_ATTACH_CHARS, MAX_COMBINED_PAGE_CHARS, withAdaptiveExtraction } from "../ai/extraction-config.js";

const require = createRequire(import.meta.url);
const pdfParse: ((buf: Buffer, opts?: { max?: number }) => Promise<{ text?: string }>) | undefined =
  (() => { try { return require("pdf-parse"); } catch { return undefined; } })();

export interface ExtractedTenderFields {
  budgetAmount?: number;
  deadlineTime?: Date;
  qualificationRequirements: QualificationRequirement[];
  /** Project manager (建造师) requirements extracted from tender text. */
  personnelRequirements: string[];
  /** Project performance requirements extracted from tender text. */
  performanceRequirements: string[];
}

const amountPatterns = [
  // Standard: 合同估算价：3154.62 万元
  /合同估算价[:：]?\s*([\d,.]+)\s*(万元|元|亿)/,
  /最高投标限价[:：]?\s*([\d,.]+)\s*(万元|元|亿)/,
  /预算金额[:：]?\s*([\d,.]+)\s*(万元|元|亿)/,
  /投标限价[:：]?\s*([\d,.]+)\s*(万元|元|亿)/,
  /招标控制价[:：]?\s*([\d,.]+)\s*(万元|元|亿)/,
  /工程概算[:：]?\s*([\d,.]+)\s*(万元|元|亿)/,
  /项目总投资[:：约]?\s*([\d,.]+)\s*(万元|元|亿)/,
  // Format: XX价为850万元 (为 instead of colon)
  /合同估算价为\s*([\d,.]+)\s*(万元|元|亿)/,
  /最高投标限价为\s*([\d,.]+)\s*(万元|元|亿)/,
  /招标控制价为\s*([\d,.]+)\s*(万元|元|亿)/,
  /预算金额为\s*([\d,.]+)\s*(万元|元|亿)/,
  /项目总投资为\s*([\d,.]+)\s*(万元|元|亿)/,
  // LYG format: 工程合同估算价（万元）：3154.62 (unit in parens before colon)
  /合同估算价(?:（([万元亿]+)）)\s*[:：]?\s*([\d,.]+)/,
  /最高投标限价(?:（([万元亿]+)）)\s*[:：]?\s*([\d,.]+)/,
  /招标控制价(?:（([万元亿]+)）)\s*[:：]?\s*([\d,.]+)/,
  /工程概算(?:（([万元亿]+)）)\s*[:：]?\s*([\d,.]+)/,
  /预算金额(?:（([万元亿]+)）)\s*[:：]?\s*([\d,.]+)/,
  /投标限价(?:（([万元亿]+)）)\s*[:：]?\s*([\d,.]+)/,
  // Zhenjiang tabular: "标段估算价（万元）" label in one cell, value in subsequent cells
  // Use constrained value (≤7 digits, optional decimal, NOT part of a longer digit sequence)
  /标段(?:合同)?估算价(?:（([万元亿]+)）)\s*[\s\S]{0,200}?(?<!\d)(\d{1,7}(?:\.\d+)?)(?!\d)/,
  /标段估算价(?:（([万元亿]+)）)\s*[\s\S]{0,200}?(?<!\d)(\d{1,7}(?:\.\d+)?)(?!\d)/,
  // Generic: any ^{p}XX价（单位）：数字
  /(?:工程)?(?:合同)?估算价(?:（([万元亿]+)）)\s*[:：]?\s*([\d,.]+)/,
  /控制价(?:（([万元亿]+)）)\s*[:：]?\s*([\d,.]+)/,
  /限价(?:（([万元亿]+)）)\s*[:：]?\s*([\d,.]+)/,
  // Tabular fallback for any 估算价（单位） with value further away
  /(?:合同)?估算价(?:（([万元亿]+)）)\s*[\s\S]{0,100}?(?<!\d)(\d{1,7}(?:\.\d+)?)(?!\d)(?:\s*(万元|元|亿))?/,
];

const deadlinePatterns = [
  // LYG format: 投标截止时间为：2026-06-29 9:00:00 (dash-separated, single-digit hour, with seconds)
  /投标截止时间\s*为\s*[:：]\s*([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})\s+([0-9]{1,2})[:：]([0-9]{1,2})(?:[:：]([0-9]{1,2}))?/,
  // 递交截止时间为：2026-06-29 9:00:00
  /递交截止时间\s*为\s*[:：]\s*([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})\s+([0-9]{1,2})[:：]([0-9]{1,2})(?:[:：]([0-9]{1,2}))?/,
  // 投标文件递交截止时间为：2026-06-29 9:00:00
  /投标文件递交截止时间\s*为\s*[:：]\s*([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})\s+([0-9]{1,2})[:：]([0-9]{1,2})(?:[:：]([0-9]{1,2}))?/,
  // 开标时间：2026-06-29 09:00 (dash-separated without seconds)
  /开标时间\s*为?\s*[:：]?\s*([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})\s+([0-9]{1,2})[:：]([0-9]{1,2})(?:[:：]([0-9]{1,2}))?/,
  // 开标时间：2026年07月15日 09:30
  /开标时间\s*为?\s*[:：]?\s*([0-9]{4})年([0-9]{1,2})月([0-9]{1,2})日\s*([0-9]{1,2})[:：]([0-9]{1,2})/,
  // 投标截止时间：2026年07月15日 09:30
  /投标截止时间[:：]?\s*([0-9]{4})年([0-9]{1,2})月([0-9]{1,2})日\s*([0-9]{1,2})[:：]([0-9]{1,2})/,
  // 递交截止时间：2026年7月15日 9:30
  /递交截止时间[:：]?\s*([0-9]{4})年([0-9]{1,2})月([0-9]{1,2})日\s*([0-9]{1,2})[:：]([0-9]{1,2})/,
  // 投标文件递交截止时间 ：2026-07-14 09:45:00 (Nanjing detail page format)
  /投标文件递交截止时间\s*[:：]\s*([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})\s+([0-9]{1,2})[:：]([0-9]{1,2})/,
  // 投标截止时间：2026/07/15 09:30
  /投标截止时间[:：]?\s*([0-9]{4})\/([0-9]{1,2})\/([0-9]{1,2})\s*([0-9]{1,2})[:：]([0-9]{1,2})/,
  // 递交截止时间：2026-07-15 09:30
  /递交截止时间[:：]?\s*([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})\s*([0-9]{1,2})[:：]([0-9]{1,2})/,
  // 投标截止时间：2026年7月15日9时30分 (compact format with 时/分)
  /投标截止时间[:：]?\s*([0-9]{4})年([0-9]{1,2})月([0-9]{1,2})日([0-9]{1,2})时([0-9]{1,2})分/,
  // 递交截止时间：2026年07月15日09时30分
  /递交截止时间[:：]?\s*([0-9]{4})年([0-9]{1,2})月([0-9]{1,2})日([0-9]{1,2})时([0-9]{1,2})分/,
  // 投标截止时间为：2026年7月15日 (为 + date-only, no time)
  /投标截止时间\s*为\s*[:：]?\s*([0-9]{4})年([0-9]{1,2})月([0-9]{1,2})日/,
  // 递交截止时间为：2026年7月15日 (为 + date-only)
  /递交截止时间\s*为\s*[:：]?\s*([0-9]{4})年([0-9]{1,2})月([0-9]{1,2})日/,
  // LYG fragmented: 投标文件递交的截止时间（投标截止时间，下同）为 2026 年 6 月 12 日 9 时 00 分
  // - tolerant gap [^0-9]{0,20}? spans the （…，下同）为 parenthetical between marker and date
  // - \s* between every digit and 年/月/日/时/分 handles &nbsp;-fragmented HTML
  /(?:投标|递交)[一-龥]{0,8}?截止时间[^0-9]{0,20}?\s*([0-9]{4})\s*年\s*([0-9]{1,2})\s*月\s*([0-9]{1,2})\s*日\s*([0-9]{1,2})\s*时\s*([0-9]{1,2})\s*分/,
  // Same tolerant marker, date-only or HH:MM (covers 为 + 2026年6月12日 / 2026年6月12日 9:30)
  /(?:投标|递交)[一-龥]{0,8}?截止时间[^0-9]{0,20}?\s*([0-9]{4})\s*年\s*([0-9]{1,2})\s*月\s*([0-9]{1,2})\s*日(?:\s+([0-9]{1,2})[:：]([0-9]{1,2}))?/,
  // Fragmented HTML: 2026年 &nbsp; 6 &nbsp; 月 &nbsp; 30 &nbsp; 日
  /投标(?:的)?截止时间\s*(?:为\s*)?[:：]?\s*([0-9]{4})\s*年\s*([0-9]{1,2})\s*月\s*([0-9]{1,2})\s*日/
];

const qualificationPattern =
  /具备([^，。；\s]+(?:施工总承包|专业承包))([特一二三壹贰叁123]级|不分等级)(?:\(含\)以上|及以上|或以上)?资质/g;

export function extractTenderFields(text: string): ExtractedTenderFields {
  return {
    budgetAmount: extractBudgetAmount(text),
    deadlineTime: extractDeadlineTime(text),
    qualificationRequirements: extractQualificationRequirements(text),
    personnelRequirements: extractPersonnelRequirements(text),
    performanceRequirements: extractPerformanceRequirements(text)
  };
}

function extractBudgetAmount(text: string): number | undefined {
  for (const pattern of amountPatterns) {
    const match = text.match(pattern);
    if (!match) continue;

    // New patterns with （单位）: group 1=unit-from-parens, group 2=value
    // Old patterns: group 1=value, group 2=trailing-unit
    let raw: string;
    let unit: string | undefined;

    if (match.length >= 3 && match[2] && /^[\d,.]+$/.test(match[2])) {
      // New-style: paren-unit is in group 1, value in group 2
      unit = match[1];      // unit from （万元）
      raw = match[2].replace(/,/g, "");
    } else {
      // Old-style: value in group 1, trailing unit in group 2
      raw = match[1].replace(/,/g, "");
      unit = match[2];
    }

    const value = Number.parseFloat(raw);
    if (Number.isNaN(value)) continue;

    if (unit === "亿") return value * 100_000_000;
    if (unit === "万元") return value * 10_000;
    return value; // default: 元
  }

  return undefined;
}

function extractDeadlineTime(text: string): Date | undefined {
  for (const pattern of deadlinePatterns) {
    const match = text.match(pattern);
    if (!match) continue;

    // Groups: 1=year, 2=month, 3=day, 4=hour, 5=minute, 6=optional-second
    const year = match[1];
    const month = String(match[2]).padStart(2, "0");
    const day = String(match[3]).padStart(2, "0");
    const hour = String(match[4] ?? "09").padStart(2, "0");
    const minute = String(match[5] ?? "30").padStart(2, "0");
    return new Date(
      `${year}-${month}-${day}T${hour}:${minute}:00+08:00`
    );
  }
  return undefined;
}

function extractQualificationRequirements(text: string): QualificationRequirement[] {
  return [...text.matchAll(qualificationPattern)].map((match) => ({
    name: match[1],
    level: normalizeLevel(match[2])
  }));
}

function normalizeLevel(level: string): string {
  const numericLevels = new Map([
    ["1级", "一级"],
    ["2级", "二级"],
    ["3级", "三级"],
    ["壹级", "一级"],
    ["贰级", "二级"],
    ["叁级", "三级"]
  ]);

  return numericLevels.get(level) ?? level;
}

const personnelPatterns = [
  /项目负责人(?:须)?具备([^，。；\s]+?)(?:专业)?([特一二三壹贰叁123]级|不分等级)(?:\(含\)以上|及以上|或以上)?(?:注册)?建造师/g,
  /拟派项目负责人(?:须)?具备([^，。；\s]+?)(?:专业)?([特一二三壹贰叁123]级|不分等级)(?:\(含\)以上|及以上|或以上)?(?:注册)?建造师/g,
  /项目负责人(?:具有|持有)([^，。；\s]+?)(?:专业)?([特一二三壹贰叁123]级|不分等级)(?:\(含\)以上|及以上|或以上)?(?:注册)?建造师(?:执业资格)?/g,
  // Nanjing detail page format: 注册建造师证建筑工程二级（含）以上
  /注册建造师证([^，。；\s]+?)([特一二三壹贰叁123]级|不分等级)(?:\(含\)以上|及以上|或以上)?/g
];

function extractPersonnelRequirements(text: string): string[] {
  const requirements: string[] = [];
  const seen = new Set<string>();

  for (const pattern of personnelPatterns) {
    for (const match of text.matchAll(pattern)) {
      const normalized = `项目负责人：${match[1]}专业 ${normalizeLevel(match[2])}建造师及以上`;
      const dedupeKey = `${match[1]}|${normalizeLevel(match[2])}`;
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        requirements.push(normalized);
      }
    }
  }

  return requirements;
}

const performancePatterns = [
  /近[三五六]年(?:内)?(?:承[担建]过|完成[过]?)([^，。；\n]+(?:工程|项目))/g,
  /(?:企业|投标人)近[三五六]年(?:内)?(?:承[担建]过|完成[过]?)([^，。；\n]+(?:工程|项目))/g,
  /(?:具有|提供)(?:承[担建]过)?(?:单项)?合同金额(?:在|不低于|超过)?[\d.]+万?(?:元|以上|[的以])?([^，。；\n]+(?:工程|项目))/g,
  /类似(?:工程)?业绩(?:要求|须)?[：:]?\s*([^，。；\n]+)/g
];

function extractPerformanceRequirements(text: string): string[] {
  const requirements: string[] = [];
  const seen = new Set<string>();

  for (const pattern of performancePatterns) {
    for (const match of text.matchAll(pattern)) {
      const requirement = match[1].trim();
      if (requirement && !seen.has(requirement)) {
        seen.add(requirement);
        requirements.push(requirement);
      }
    }
  }

  return requirements;
}

/**
 * PRIMARY extraction: uses DeepSeek AI to parse all tender fields.
 *
 * Strategy:
 * 1. Extract from page HTML (fast, covers most cases)
 * 2. If key fields missing, also parse attachment texts (PDFs/DOCXs)
 * 3. Fall back to regex only if AI is unavailable
 *
 * Mutates tender in place. Safe to call without AI key (uses regex only).
 */
export async function enrichTenderWithAI(
  tender: TenderNotice
): Promise<void> {
  // Build the full text corpus: page HTML + attachment texts
  const html = tender.sourceHtml;
  const attachmentTexts = (tender.documentTexts ?? []).filter(
    (t) => t && t.trim().length > 20
  );

  // Phase 1: AI on page HTML (with adaptive extraction window)
  if (html && html.length >= 100) {
    const aiFields = await withAdaptiveExtraction((pageLimit) =>
      extractTenderFromPage(html, pageLimit)
    );

    if (aiFields) {
      applyAiFields(tender, aiFields);

      // If budget still missing, try attachment texts (stored or auto-discovered)
      if (!tender.budgetAmount) {
        let attachTexts = attachmentTexts;

        // If no stored attachment texts, try to discover + download from sourceHtml
        if (attachTexts.length === 0 && pdfParse) {
          const discovered = await discoverAndParseAttachments(html);
          if (discovered.length > 0) {
            attachTexts = discovered;
            tender.documentTexts = discovered;
          }
        }

        if (attachTexts.length > 0) {
          const escapedAttach = attachTexts
            .map((t) => escapeNonHtml(t))
            .join("\n---\n")
            .slice(0, MAX_ATTACH_CHARS);
          const combinedHtml = "<html><body>" + escapedAttach + "\n\n===页面内容===\n" + html.slice(0, MAX_COMBINED_PAGE_CHARS) + "</body></html>";
          const aiAttach = await extractTenderFromPage(combinedHtml);
          if (aiAttach) {
            applyAiFields(tender, aiAttach);
          }
        }
      }
      return;
    }
  }

  // Phase 2: AI on attachment texts only (no page HTML)
  if (attachmentTexts.length > 0) {
    const escaped = attachmentTexts
      .map((t) => escapeNonHtml(t))
      .join("\n---\n")
      .slice(0, MAX_ATTACH_CHARS * 2);
    const aiFields = await extractTenderFromPage(
      `<html><body>${escaped}</body></html>`
    );
    if (aiFields) {
      applyAiFields(tender, aiFields);
      return;
    }
  }

  // Phase 3: regex fallback — only when AI is unavailable
  const text = [tender.title, tender.contentText, ...attachmentTexts].join("\n");
  const regexFields = extractTenderFields(text);
  if (!tender.budgetAmount && regexFields.budgetAmount) {
    tender.budgetAmount = regexFields.budgetAmount;
  }
  if (!tender.deadlineTime && regexFields.deadlineTime) {
    tender.deadlineTime = regexFields.deadlineTime;
  }
  if (
    regexFields.qualificationRequirements.length > 0 &&
    tender.qualificationRequirements.length === 0
  ) {
    tender.qualificationRequirements = regexFields.qualificationRequirements;
  }
  if (
    regexFields.personnelRequirements.length > 0 &&
    !tender.personnelRequirements?.length
  ) {
    tender.personnelRequirements = regexFields.personnelRequirements;
  }
  if (
    regexFields.performanceRequirements.length > 0 &&
    !tender.performanceRequirements?.length
  ) {
    tender.performanceRequirements = regexFields.performanceRequirements;
  }
}

/** Apply AI-extracted fields to tender (only fills in missing values). */
function applyAiFields(
  tender: TenderNotice,
  fields: import("../analysis/ai-extract.js").AiExtractedFields
): void {
  if (fields.budgetAmount && fields.budgetAmount > 0) {
    tender.budgetAmount = fields.budgetAmount;
  }
  if (fields.publishDate && !tender.publishDate) {
    tender.publishDate = fields.publishDate;
  }
  if (fields.deadlineTime) {
    const parsed = new Date(fields.deadlineTime);
    if (!Number.isNaN(parsed.getTime()) && !tender.deadlineTime) {
      tender.deadlineTime = parsed;
    }
  }
  if (fields.qualificationRequirements.length > 0) {
    const existing = new Set(tender.qualificationRequirements.map((q) => q.name));
    for (const q of fields.qualificationRequirements) {
      if (!existing.has(q.name)) {
        tender.qualificationRequirements.push(q);
      }
    }
  }
  if (fields.personnelRequirements.length > 0) {
    const existing = new Set(tender.personnelRequirements ?? []);
    for (const p of fields.personnelRequirements) {
      if (!existing.has(p)) {
        if (!tender.personnelRequirements) tender.personnelRequirements = [];
        tender.personnelRequirements.push(p);
      }
    }
  }
  if (fields.performanceRequirements.length > 0) {
    const existing = new Set(tender.performanceRequirements ?? []);
    for (const p of fields.performanceRequirements) {
      if (!existing.has(p)) {
        if (!tender.performanceRequirements) tender.performanceRequirements = [];
        tender.performanceRequirements.push(p);
      }
    }
  }
}

/** Discover attachment links in HTML, download PDFs, and return parsed text. */
async function discoverAndParseAttachments(html: string): Promise<string[]> {
  const texts: string[] = [];
  if (!pdfParse) return texts;

  // Match common attachment URL patterns
  const patterns = [
    /attachId=([a-f0-9-]+)/gi,           // Nanjing preview API
    /\/attach\/download[^"'\s]*/gi,       // Generic download
    /href="([^"]*\.pdf[^"]*)"/gi,         // Direct PDF links
    /href="([^"]*\.docx?[^"]*)"/gi        // Direct DOCX links
  ];

  const urls = new Set<string>();
  for (const pattern of patterns) {
    for (const m of html.matchAll(pattern)) {
      let url = m[1] || m[0];
      // Build full URL for attachId patterns
      if (url.length === 36 && /^[a-f0-9-]+$/i.test(url)) {
        url = `http://njggzy.nanjing.gov.cn/njxm-prod/api/attach/preview?attachId=${url}`;
      }
      urls.add(url);
    }
  }

  for (const url of urls) {
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 Chrome/126" },
        signal: AbortSignal.timeout(30000)
      });
      if (!resp.ok) continue;
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length < 100) continue;

      // PDF: %PDF
      if (buf[0] === 0x25 && buf[1] === 0x50) {
        const result = await pdfParse(buf, { max: 30 });
        if (result.text && result.text.length > 100) {
          texts.push(result.text);
        }
        continue;
      }
      // DOCX (ZIP-based): PK
      if (buf[0] === 0x50 && buf[1] === 0x4b) {
        try {
          const mammoth = require("mammoth") as {
            extractRawText(input: { buffer: Buffer }): Promise<{ value?: string }>;
          };
          const result = await mammoth.extractRawText({ buffer: buf });
          if (result.value && result.value.trim().length > 100) {
            texts.push(result.value.trim());
          }
        } catch { /* mammoth parse failed */ }
        continue;
      }
      // OLE2 (.doc): D0 CF 11 E0
      if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) {
        try {
          const mammoth = require("mammoth") as {
            extractRawText(input: { buffer: Buffer }): Promise<{ value?: string }>;
          };
          const result = await mammoth.extractRawText({ buffer: buf });
          if (result.value && result.value.trim().length > 100) {
            texts.push(result.value.trim());
          }
        } catch { /* mammoth parse failed */ }
        continue;
      }
    } catch { /* skip failed downloads */ }
  }

  return texts;
}
