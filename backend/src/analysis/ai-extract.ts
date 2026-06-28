/**
 * Comprehensive AI-powered tender page parser using DeepSeek-v4-flash.
 *
 * PRIMARY extraction method — replaces regex with structured AI parsing.
 * Regex is only used as fallback if the AI call fails.
 */

import { chat } from "../ai/config.js";
import type { QualificationRequirement } from "../domain/types.js";

export interface AiExtractedFields {
  budgetAmount?: number;
  deadlineTime?: string;
  publishDate?: string;
  qualificationRequirements: QualificationRequirement[];
  personnelRequirements: string[];
  performanceRequirements: string[];
}

/**
 * Escape angle brackets in non-HTML content so they survive tag stripping.
 * PDF/DOCX parsed text often contains <0A>, <EOL>, etc.
 */
export function escapeNonHtml(content: string): string {
  return content
    .replace(/</g, "〈")
    .replace(/>/g, "〉");
}

/* ── Smart HTML preprocessing ── */

/**
 * Extract the main content block from a government tender page,
 * stripping nav, header, footer, scripts, and styles. Reduces
 * 70KB+ pages down to 3-8KB of dense, relevant text for the AI.
 */
function preprocessHtml(html: string): string {
  // 1. Remove non-content elements
  let text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<meta\b[^>]*>/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, "");

  // 2. Convert to plain text — keep structure via line breaks
  text = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/tr>/gi, " | ")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#?\w+;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ {2,}/g, " ")
    .trim();

  // 3. Light dedup and trim — remove common nav boilerplate lines
  const seen = new Set<string>();
  const lines = text.split("\n").filter((line) => {
    const trimmed = line.trim();
    if (trimmed.length < 1) return false;
    if (/^(首页|返回|上一页|下一页|设为首页|收藏本站|网站地图|加入收藏|繁體版|简體版)$/.test(trimmed)) return false;
    // Deduplicate identical lines (common in table-based layouts)
    if (seen.has(trimmed)) return false;
    seen.add(trimmed);
    return true;
  });

  return lines.join("\n").slice(0, 15000);
}

/* ── Efficient prompt ── */

const SYSTEM_PROMPT =
  "你是招标公告解析器。只返回JSON，不要任何解释或markdown。";

function buildPrompt(text: string): string {
  return `从招标公告提取以下字段，返回JSON：

{
"budget": 数字(元,万元×10000,亿元×1e8,未找到则null),
"deadline": "ISO时间"或null,
"pubDate": "YYYY-MM-DD"或null,
"quals": [{"n":"资质名","l":"特级/一级/二级/三级/甲级/乙级/丙级/不分等级"}],
"persons": ["人员要求原文"],
"perfs": ["业绩要求原文"]
}

示例：
输入"合同估算价5200万元。投标截止2026年7月15日9:30。具备建筑工程施工总承包一级资质。项目负责人须具备建筑工程一级注册建造师。近三年承接过单项合同5000万以上市政工程。"
输出{"budget":52000000,"deadline":"2026-07-15T09:30:00+08:00","pubDate":null,"quals":[{"n":"建筑工程施工总承包","l":"一级"}],"persons":["项目负责人：建筑工程一级注册建造师"],"perfs":["近三年承接过单项合同5000万以上市政工程"]}

内容：
${text}`;
}

/* ── Main API ── */

export async function extractTenderFromPage(
  html: string
): Promise<AiExtractedFields | null> {
  const text = preprocessHtml(html);
  if (text.length < 30) return null;

  const result = await chat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildPrompt(text) }
    ],
    { temperature: 0, max_tokens: 2048 }
  );

  if (!result) return null;

  try {
    // Strip markdown code fences if present
    let jsonStr = result
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    // Minimal fixes: trailing commas only
    jsonStr = jsonStr
      .replace(/,\s*}/g, "}")
      .replace(/,\s*]/g, "]");

    // Try direct parse first
    try {
      const p = JSON.parse(jsonStr) as Record<string, unknown>;
      return buildResult(p);
    } catch {
      // Fallback: regex extraction of individual fields
      const budget = jsonStr.match(/"budget"\s*:\s*([\d.]+)/);
      const deadline = jsonStr.match(/"deadline"\s*:\s*"([^"]+)"/);
      const pubDate = jsonStr.match(/"pubDate"\s*:\s*"([^"]+)"/);
      const quals = jsonStr.match(/"quals"\s*:\s*(\[[^\]]*\])/);
      const persons = jsonStr.match(/"persons"\s*:\s*(\[[^\]]*\])/);
      const perfs = jsonStr.match(/"perfs"\s*:\s*(\[[^\]]*\])/);

      if (!budget && !deadline && !pubDate) {
        console.warn("AI parse: no fields found in:", jsonStr.slice(0, 100));
        return null;
      }

      return {
        budgetAmount: budget ? Number(budget[1]) : undefined,
        deadlineTime: deadline?.[1] || undefined,
        publishDate: pubDate?.[1] || undefined,
        qualificationRequirements: parseQuals(quals?.[1]),
        personnelRequirements: parseStrings(persons?.[1]),
        performanceRequirements: parseStrings(perfs?.[1])
      };
    }
  } catch (err) {
    console.warn("AI parse error:", String(err));
    return null;
  }
}

function buildResult(p: Record<string, unknown>): AiExtractedFields {
  return {
    budgetAmount:
      typeof p.budget === "number" && p.budget > 0 ? p.budget : undefined,
    deadlineTime: typeof p.deadline === "string" ? p.deadline : undefined,
    publishDate: typeof p.pubDate === "string" ? p.pubDate : undefined,
    qualificationRequirements: parseQuals(p.quals),
    personnelRequirements: parseStrings(p.persons),
    performanceRequirements: parseStrings(p.perfs)
  };
}

function parseQuals(raw: unknown): QualificationRequirement[] {
  // Handle JSON string input (from regex fallback)
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (q) =>
        typeof q === "object" &&
        q &&
        typeof (q as Record<string, unknown>).n === "string" &&
        typeof (q as Record<string, unknown>).l === "string"
    )
    .map((q) => ({
      name: ((q as Record<string, unknown>).n as string).trim(),
      level: ((q as Record<string, unknown>).l as string).trim()
    }));
}

function parseStrings(raw: unknown): string[] {
  if (typeof raw === "string") {
    try { const arr = JSON.parse(raw); if (Array.isArray(arr)) raw = arr; else return []; }
    catch { return []; }
  }
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === "string" && s.trim().length > 0);
}

/**
 * Legacy budget-only extraction. Kept for backward compat.
 */
export async function extractBudgetWithAI(
  text: string
): Promise<number | undefined> {
  const result = await extractTenderFromPage(text);
  return result?.budgetAmount;
}
