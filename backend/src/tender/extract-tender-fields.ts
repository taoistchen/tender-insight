import type { QualificationRequirement } from "../domain/types.js";

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
