import type { QualificationRequirement, TenderNotice } from "../domain/types.js";
import { extractTenderFromPage, escapeNonHtml } from "../analysis/ai-extract.js";

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
  /合同估算价[:：]?\s*([\d.]+)\s*(万元|元)/,
  /最高投标限价[:：]?\s*([\d.]+)\s*(万元|元)/,
  /预算金额[:：]?\s*([\d.]+)\s*(万元|元)/
];

const deadlinePatterns = [
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
  /递交截止时间[:：]?\s*([0-9]{4})年([0-9]{1,2})月([0-9]{1,2})日([0-9]{1,2})时([0-9]{1,2})分/
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
    if (!match) {
      continue;
    }

    const value = Number.parseFloat(match[1]);
    if (Number.isNaN(value)) {
      return undefined;
    }

    return match[2] === "万元" ? value * 10_000 : value;
  }

  return undefined;
}

function extractDeadlineTime(text: string): Date | undefined {
  for (const pattern of deadlinePatterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }

    const [, year, month, day, hour, minute] = match;
    return new Date(
      `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(
        2,
        "0"
      )}:${minute.padStart(2, "0")}:00+08:00`
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

  // Phase 1: AI on page HTML
  if (html && html.length >= 100) {
    const aiFields = await extractTenderFromPage(html);

    if (aiFields) {
      applyAiFields(tender, aiFields);

      // If budget still missing but we have attachment texts, try again
      if (!tender.budgetAmount && attachmentTexts.length > 0) {
        const escapedAttach = attachmentTexts
          .map((t) => escapeNonHtml(t))
          .join("\n---\n")
          .slice(0, 8000);
        // Put attachment text first so it's within the preprocessing window
        const combinedHtml = "<html><body>" + escapedAttach + "\n\n===页面内容===\n" + html + "</body></html>";
        const aiAttach = await extractTenderFromPage(combinedHtml);
        if (aiAttach) {
          applyAiFields(tender, aiAttach);
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
      .slice(0, 12000);
    const aiFields = await extractTenderFromPage(
      `<html><body>${escaped}</body></html>`
    );
    if (aiFields) {
      applyAiFields(tender, aiFields);
      return;
    }
  }

  // Phase 3: AI unavailable — regex fallback
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
