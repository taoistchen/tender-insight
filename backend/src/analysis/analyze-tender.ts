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

const QUALIFICATION_SUFFIX_PATTERN =
  /(?:施工总承包|专业承包|工程|施工|承包|construction|general contracting|contracting)/gi;

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
    tender.title.includes(keyword)
  );
  if (excludedKeyword) {
    return rejected(0, matchedPoints, [
      `Excluded keyword in title: ${excludedKeyword}`
    ]);
  }

  if (!company.preferredRegions.includes(tender.city)) {
    return rejected(0, matchedPoints, [`City not preferred: ${tender.city}`]);
  }
  score += 10;
  matchedPoints.push(`Region matched: ${tender.city}`);

  const projectTypeMatched = company.preferredProjectTypes.some((type) =>
    `${tender.title}\n${tender.contentText}`.includes(type)
  );
  if (projectTypeMatched) {
    score += 15;
    matchedPoints.push("Project type matched company preferences");
  }

  const qualificationResult = matchQualifications(tender, company);
  if (!qualificationResult.passed) {
    return rejected(score, matchedPoints, qualificationResult.riskPoints);
  }
  score += qualificationResult.score;
  matchedPoints.push(...qualificationResult.matchedPoints);
  riskPoints.push(...qualificationResult.riskPoints);

  const personnelResult = matchPersonnel(tender, company);
  if (personnelResult.riskPoints.length > 0) {
    riskPoints.push(...personnelResult.riskPoints);
  } else if (personnelResult.score > 0) {
    score += personnelResult.score;
    matchedPoints.push(...personnelResult.matchedPoints);
  } else {
    score += 20;
    matchedPoints.push("No explicit personnel hard limit found");
  }

  const performanceResult = matchPerformances(tender, company);
  if (performanceResult.riskPoints.length > 0) {
    riskPoints.push(...performanceResult.riskPoints);
  } else if (performanceResult.score > 0) {
    score += performanceResult.score;
    matchedPoints.push(...performanceResult.matchedPoints);
  } else {
    score += 15;
    matchedPoints.push("No explicit performance hard limit found");
  }

  if (tender.budgetAmount !== undefined) {
    const minOk =
      company.minProjectAmount === undefined ||
      company.minProjectAmount === 0 ||
      tender.budgetAmount >= company.minProjectAmount;
    const maxOk = tender.budgetAmount <= company.maxProjectAmount;
    if (minOk && maxOk) {
      score += 10;
      matchedPoints.push("Project budget is within company range");
    } else if (!maxOk) {
      return rejected(score, matchedPoints, [
        "Project budget exceeds company maximum"
      ]);
    } else {
      riskPoints.push(
        `Project budget is below company minimum: ${company.minProjectAmount.toLocaleString()}`
      );
    }
  }

  const remainingDays = tender.deadlineTime
    ? Math.ceil((tender.deadlineTime.getTime() - now.getTime()) / 86_400_000)
    : undefined;
  if (remainingDays !== undefined && remainingDays < 0) {
    return rejected(score, matchedPoints, ["Deadline has passed"]);
  }
  if (remainingDays !== undefined && remainingDays >= company.minRemainingDays) {
    score += 5;
    matchedPoints.push(`Preparation time is sufficient: ${remainingDays} days`);
  } else {
    riskPoints.push("Preparation time is insufficient or deadline is unknown");
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

function qualificationNameMatches(
  requirementName: string,
  companyQualName: string
): boolean {
  if (
    requirementName.includes(companyQualName) ||
    companyQualName.includes(requirementName)
  ) {
    return true;
  }

  const reqCore = requirementName.replace(QUALIFICATION_SUFFIX_PATTERN, "");
  const qualCore = companyQualName.replace(QUALIFICATION_SUFFIX_PATTERN, "");
  if (reqCore === qualCore) return true;

  const reqChars = new Set(reqCore);
  const qualChars = new Set(qualCore);
  const intersection = [...reqChars].filter((c) => qualChars.has(c)).length;
  const union = reqChars.size + qualChars.size - intersection;
  return union > 0 && intersection / union >= 0.7;
}

function matchQualifications(tender: TenderNotice, company: CompanyProfile) {
  if (tender.qualificationRequirements.length === 0) {
    return {
      passed: true,
      score: 10,
      matchedPoints: [] as string[],
      riskPoints: ["Qualification requirements are unclear"]
    };
  }

  const matchedPoints: string[] = [];
  const riskPoints: string[] = [];

  for (const requirement of tender.qualificationRequirements) {
    const actual = company.qualifications.find((qualification) =>
      qualificationNameMatches(requirement.name, qualification.name)
    );

    if (!actual || !levelSatisfies(actual.level, requirement.level)) {
      riskPoints.push(
        `Missing required qualification: ${requirement.name} ${requirement.level}`
      );
      return { passed: false, score: 0, matchedPoints, riskPoints };
    }

    matchedPoints.push(
      `Qualification matched: ${requirement.name} ${actual.level} >= ${requirement.level}`
    );
  }

  return { passed: true, score: 25, matchedPoints, riskPoints };
}

function matchPersonnel(tender: TenderNotice, company: CompanyProfile) {
  const requirements = tender.personnelRequirements ?? [];
  if (requirements.length === 0) {
    return { score: 0, matchedPoints: [] as string[], riskPoints: [] as string[] };
  }

  const personnel = company.personnel ?? [];
  if (personnel.length === 0) {
    return {
      score: 0,
      matchedPoints: [] as string[],
      riskPoints: requirements.map(
        (req) =>
          `Personnel requirement not matched: ${req} (company personnel records are empty)`
      )
    };
  }

  const matchedPoints: string[] = [];
  const riskPoints: string[] = [];
  for (const requirement of requirements) {
    const matched = personnel.find((person) =>
      personnelMatchesRequirement(person, requirement)
    );
    if (matched) {
      matchedPoints.push(
        `Personnel requirement matched: ${requirement} (${matched.personName})`
      );
    } else {
      riskPoints.push(`Personnel requirement not matched: ${requirement}`);
    }
  }

  return {
    score: riskPoints.length === 0 ? 20 : 0,
    matchedPoints,
    riskPoints
  };
}

function matchPerformances(tender: TenderNotice, company: CompanyProfile) {
  const requirements = tender.performanceRequirements ?? [];
  if (requirements.length === 0) {
    return { score: 0, matchedPoints: [] as string[], riskPoints: [] as string[] };
  }

  const performances = company.performances ?? [];
  if (performances.length === 0) {
    return {
      score: 0,
      matchedPoints: [] as string[],
      riskPoints: requirements.map(
        (req) =>
          `Performance requirement not matched: ${req} (company performance records are empty)`
      )
    };
  }

  const matchedPoints: string[] = [];
  const riskPoints: string[] = [];
  for (const requirement of requirements) {
    const matched = performances.find((performance) =>
      performanceMatchesRequirement(performance, requirement)
    );
    if (matched) {
      matchedPoints.push(
        `Performance requirement matched: ${requirement} (${matched.projectName})`
      );
    } else {
      riskPoints.push(`Performance requirement not matched: ${requirement}`);
    }
  }

  return {
    score: riskPoints.length === 0 ? 15 : 0,
    matchedPoints,
    riskPoints
  };
}

function personnelMatchesRequirement(
  person: NonNullable<CompanyProfile["personnel"]>[number],
  requirement: string
): boolean {
  const req = normalizeForMatch(requirement);
  const certificate = normalizeForMatch(person.certificateType ?? "");
  const major = normalizeForMatch(person.major ?? "");
  const level = normalizeForMatch(person.level ?? "");
  const requiredLevel = extractRequiredLevel(requirement);

  const certificateOk = !certificate || req.includes(certificate);
  const majorOk = !major || req.includes(major);
  const levelOk =
    !level ||
    req.includes(level) ||
    Boolean(
      requiredLevel &&
        person.level &&
        levelSatisfies(person.level, requiredLevel)
    );

  return certificateOk && majorOk && levelOk;
}

function performanceMatchesRequirement(
  performance: NonNullable<CompanyProfile["performances"]>[number],
  requirement: string
): boolean {
  const req = normalizeForMatch(requirement);
  const fields = [performance.projectName, performance.projectType ?? ""]
    .map(normalizeForMatch)
    .filter(Boolean);

  return fields.some((field) => {
    if (req.includes(field) || field.includes(req)) return true;
    return tokenOverlap(req, field) >= 0.5;
  });
}

function extractRequiredLevel(requirement: string): string | undefined {
  const match = requirement.match(
    /(Class\s*[1-4]|[一二三四特甲乙丙]级|不分等级|涓€绾?|浜岀骇|涓夌骇|鐗圭骇|鐢茬骇|涔欑骇|涓欑骇)/i
  );
  return match?.[1]?.replace(/\s+/g, " ");
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenOverlap(left: string, right: string): number {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = [...leftTokens].filter((token) =>
    rightTokens.has(token)
  ).length;
  return intersection / Math.min(leftTokens.size, rightTokens.size);
}

function tokenSet(value: string): Set<string> {
  return new Set(
    value
      .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  );
}

function mapDecision(score: number, riskPoints: string[]): Decision {
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
