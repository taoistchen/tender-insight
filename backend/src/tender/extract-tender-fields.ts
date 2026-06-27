import type { QualificationRequirement } from "../domain/types.js";

export interface ExtractedTenderFields {
  budgetAmount?: number;
  deadlineTime?: Date;
  qualificationRequirements: QualificationRequirement[];
}

const amountPatterns = [
  /合同估算价[:：]?\s*([\d.]+)\s*(万元|元)/,
  /最高投标限价[:：]?\s*([\d.]+)\s*(万元|元)/,
  /预算金额[:：]?\s*([\d.]+)\s*(万元|元)/
];

const deadlinePatterns = [
  /投标截止时间[:：]?\s*([0-9]{4})年([0-9]{1,2})月([0-9]{1,2})日\s*([0-9]{1,2})[:：]([0-9]{1,2})/,
  /递交截止时间[:：]?\s*([0-9]{4})年([0-9]{1,2})月([0-9]{1,2})日\s*([0-9]{1,2})[:：]([0-9]{1,2})/
];

const qualificationPattern =
  /具备([^，。；\s]+(?:施工总承包|专业承包))([特一二三壹贰叁123]级|不分等级)及以上资质/g;

export function extractTenderFields(text: string): ExtractedTenderFields {
  return {
    budgetAmount: extractBudgetAmount(text),
    deadlineTime: extractDeadlineTime(text),
    qualificationRequirements: extractQualificationRequirements(text)
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
