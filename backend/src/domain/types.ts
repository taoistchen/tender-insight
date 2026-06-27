export type Decision =
  | "recommended"
  | "watch"
  | "manual_review"
  | "not_recommended"
  | "rejected";

export interface QualificationRequirement {
  name: string;
  level: string;
}

export interface CompanyQualification {
  name: string;
  level: string;
  validTo?: Date;
}

export interface CompanyProfile {
  companyName: string;
  preferredRegions: string[];
  preferredProjectTypes: string[];
  excludedKeywords: string[];
  maxProjectAmount: number;
  minRemainingDays: number;
  qualifications: CompanyQualification[];
}

export interface TenderNotice {
  city: string;
  title: string;
  contentText: string;
  budgetAmount?: number;
  deadlineTime?: Date;
  qualificationRequirements: QualificationRequirement[];
}

export interface TenderAnalysisResult {
  decision: Decision;
  matchScore: number;
  matchedPoints: string[];
  riskPoints: string[];
  manualReviewRequired: boolean;
}
