import type {
  CompanyProfile,
  Decision,
  TenderAnalysisResult,
  TenderNotice
} from "../domain/types.js";
import { levelSatisfies } from "../domain/qualification-level.js";

export interface AnalyzeTenderOptions {
  now?: Date;
}

export function analyzeTender(
  tender: TenderNotice,
  company: CompanyProfile,
  options: AnalyzeTenderOptions = {}
): TenderAnalysisResult {
  const now = options.now ?? new Date();
  const matchedPoints: string[] = [];
  const riskPoints: string[] = [];
  let score = 0;

  const excludedKeyword = company.excludedKeywords.find((keyword) =>
    `${tender.title}\n${tender.contentText}`.includes(keyword)
  );
  if (excludedKeyword) {
    return rejected(0, matchedPoints, [`包含排除关键词：${excludedKeyword}`]);
  }

  if (!company.preferredRegions.includes(tender.city)) {
    return rejected(0, matchedPoints, [`地区不在公司可投范围内：${tender.city}`]);
  }
  score += 10;
  matchedPoints.push(`地区在公司可投范围内：${tender.city}`);

  const projectTypeMatched = company.preferredProjectTypes.some((type) =>
    `${tender.title}\n${tender.contentText}`.includes(type)
  );
  if (projectTypeMatched) {
    score += 15;
    matchedPoints.push("项目类型匹配公司偏好");
  }

  const qualificationResult = matchQualifications(tender, company);
  if (!qualificationResult.passed) {
    return rejected(score, matchedPoints, qualificationResult.riskPoints);
  }
  score += qualificationResult.score;
  matchedPoints.push(...qualificationResult.matchedPoints);
  riskPoints.push(...qualificationResult.riskPoints);

  score += 20;
  matchedPoints.push("未发现明确人员硬性限制");

  score += 15;
  matchedPoints.push("未发现明确业绩硬性限制");

  if (tender.budgetAmount !== undefined && tender.budgetAmount <= company.maxProjectAmount) {
    score += 10;
    matchedPoints.push("项目金额在公司承接范围内");
  } else if (tender.budgetAmount !== undefined) {
    return rejected(score, matchedPoints, ["项目金额超过公司最大承接范围"]);
  }

  const remainingDays = tender.deadlineTime
    ? Math.ceil((tender.deadlineTime.getTime() - now.getTime()) / 86_400_000)
    : undefined;
  if (remainingDays !== undefined && remainingDays < 0) {
    return rejected(score, matchedPoints, ["投标截止时间已过"]);
  }
  if (remainingDays !== undefined && remainingDays >= company.minRemainingDays) {
    score += 5;
    matchedPoints.push(`投标准备时间满足要求：剩余 ${remainingDays} 天`);
  } else {
    riskPoints.push("投标准备时间不足或截止时间不明确");
  }

  const decision = mapDecision(score, riskPoints);

  return {
    decision,
    matchScore: score,
    matchedPoints,
    riskPoints,
    manualReviewRequired: decision === "manual_review"
  };
}

function matchQualifications(tender: TenderNotice, company: CompanyProfile) {
  if (tender.qualificationRequirements.length === 0) {
    return {
      passed: true,
      score: 10,
      matchedPoints: [] as string[],
      riskPoints: ["资质要求未明确，需人工核对公告原文"]
    };
  }

  const matchedPoints: string[] = [];
  const riskPoints: string[] = [];

  for (const requirement of tender.qualificationRequirements) {
    const actual = company.qualifications.find((qualification) =>
      requirement.name.includes(qualification.name)
    );

    if (!actual || !levelSatisfies(actual.level, requirement.level)) {
      riskPoints.push(`缺少要求资质：${requirement.name} ${requirement.level}`);
      return { passed: false, score: 0, matchedPoints, riskPoints };
    }

    matchedPoints.push(
      `资质满足：${requirement.name} ${actual.level} >= ${requirement.level}`
    );
  }

  return {
    passed: true,
    score: 25,
    matchedPoints,
    riskPoints
  };
}

function mapDecision(score: number, riskPoints: string[]): Decision {
  if (score >= 85 && riskPoints.length === 0) {
    return "recommended";
  }
  if (riskPoints.length > 0 && score >= 50) {
    return "manual_review";
  }
  if (score >= 70) {
    return "watch";
  }
  if (score >= 50) {
    return "manual_review";
  }
  return "not_recommended";
}

function rejected(
  score: number,
  matchedPoints: string[],
  riskPoints: string[]
): TenderAnalysisResult {
  return {
    decision: "rejected",
    matchScore: score,
    matchedPoints,
    riskPoints,
    manualReviewRequired: false
  };
}
