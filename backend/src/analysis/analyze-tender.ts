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

/** Common suffix patterns in Chinese qualification names that carry no distinguishing information. */
const QUALIFICATION_SUFFIX_PATTERN = /(?:施工总承包|专业承包|工程|施工|承包)/g;

/**
 * Compare two Chinese qualification names with fuzzy character-set matching
 * to tolerate word-order variations common in tender documents.
 *
 * Examples of variation handled:
 *   - "建筑装修装饰工程专业承包" vs "建筑装饰装修工程专业承包"
 *   - "消防设施工程专业承包" vs "消防设施专业承包"
 */
function qualificationNameMatches(
  requirementName: string,
  companyQualName: string
): boolean {
  // Direct substring match (either direction)
  if (
    requirementName.includes(companyQualName) ||
    companyQualName.includes(requirementName)
  ) {
    return true;
  }

  // Strip generic suffixes and compare the distinctive core
  const reqCore = requirementName.replace(QUALIFICATION_SUFFIX_PATTERN, "");
  const qualCore = companyQualName.replace(QUALIFICATION_SUFFIX_PATTERN, "");

  // After stripping suffixes the cores may be identical
  if (reqCore === qualCore) {
    return true;
  }

  // Character-set Jaccard similarity on the core — handles word-order flips
  // like "装修装饰" vs "装饰装修"
  const reqChars = new Set(reqCore);
  const qualChars = new Set(qualCore);
  const intersection = [...reqChars].filter((c) => qualChars.has(c)).length;
  const union = reqChars.size + qualChars.size - intersection;

  // Threshold of 0.7 catches genuine variants while rejecting
  // unrelated qualifications like "市政" vs "建筑"
  return intersection / union >= 0.7;
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

  // Excluded-service keywords are checked against the title only.
  // The tender title tells you what the tender IS FOR (e.g. "监理招标公告"
  // means the tender is for supervision services).  Construction tenders
  // routinely mention "监理单位" in their body text without being
  // supervision-service tenders, so we avoid false positives by scoping
  // this check to the title.
  const excludedKeyword = company.excludedKeywords.find((keyword) =>
    tender.title.includes(keyword)
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

  // Personnel matching: if tender explicitly lists personnel requirements, report them
  // for traceability. Full matching against company personnel records is a later feature.
  if (tender.personnelRequirements && tender.personnelRequirements.length > 0) {
    riskPoints.push(
      `公告明确要求人员：${tender.personnelRequirements.join("；")}。人员匹配功能待实现，需人工核对`
    );
  } else {
    score += 20;
    matchedPoints.push("未发现明确人员硬性限制");
  }

  // Performance matching: if tender explicitly lists performance requirements, report them
  if (tender.performanceRequirements && tender.performanceRequirements.length > 0) {
    riskPoints.push(
      `公告明确要求业绩：${tender.performanceRequirements.join("；")}。业绩匹配功能待实现，需人工核对`
    );
  } else {
    score += 15;
    matchedPoints.push("未发现明确业绩硬性限制");
  }

  if (tender.budgetAmount !== undefined) {
    const minOk = company.minProjectAmount === undefined || company.minProjectAmount === 0 || tender.budgetAmount >= company.minProjectAmount;
    const maxOk = tender.budgetAmount <= company.maxProjectAmount;
    if (minOk && maxOk) {
      score += 10;
      matchedPoints.push("项目金额在公司承接范围内");
    } else if (!maxOk) {
      return rejected(score, matchedPoints, ["项目金额超过公司最大承接范围"]);
    } else {
      riskPoints.push(`项目金额低于公司最小承接金额（${company.minProjectAmount.toLocaleString()} 元），可能需要评估`);
    }
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
      qualificationNameMatches(requirement.name, qualification.name)
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
  // Aligned with spec: score 85-100 → recommended, 70-84 → watch,
  // 50-69 → manual_review, <50 → not_recommended
  // Hard rejections (excluded keyword, wrong city, missing qual, expired, over budget)
  // are handled before this function and return "rejected" directly.
  if (riskPoints.length > 0 && score >= 50) {
    return "manual_review";
  }
  if (score >= 85 && riskPoints.length === 0) {
    return "recommended";
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
