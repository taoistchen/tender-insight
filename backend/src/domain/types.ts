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

export interface CompanyPersonnel {
  personName: string;
  certificateType?: string;
  major?: string;
  level?: string;
  validTo?: Date;
}

export interface CompanyPerformance {
  projectName: string;
  projectType?: string;
  amount?: number;
  completionDate?: Date;
}

export interface CompanyProfile {
  companyName: string;
  preferredRegions: string[];
  preferredProjectTypes: string[];
  excludedKeywords: string[];
  maxProjectAmount: number;
  minProjectAmount: number;
  minRemainingDays: number;
  qualifications: CompanyQualification[];
  personnel?: CompanyPersonnel[];
  performances?: CompanyPerformance[];
}

export type TenderLinkKind = "detail" | "document" | "external" | "other";

export interface TenderResolvedLink {
  url: string;
  label: string;
  sourcePageUrl: string;
  kind: TenderLinkKind;
}

export type TenderAttachmentStatus =
  | "linked"
  | "parsed"
  | "unsupported"
  | "failed";

export interface TenderAttachment {
  url: string;
  label: string;
  sourcePageUrl: string;
  contentType?: string;
  status: TenderAttachmentStatus;
  textContent?: string;
  error?: string;
}

export interface TenderNotice {
  city: string;
  sourceSite: string;
  title: string;
  url: string;
  contentText: string;
  sourceHtml?: string;
  resolvedLinks?: TenderResolvedLink[];
  attachments?: TenderAttachment[];
  documentTexts?: string[];
  budgetAmount?: number;
  deadlineTime?: Date;
  publishDate?: string;
  qualificationRequirements: QualificationRequirement[];
  /** Raw personnel requirement strings extracted from tender text. */
  personnelRequirements?: string[];
  /** Raw performance requirement strings extracted from tender text. */
  performanceRequirements?: string[];
}

export interface TenderAnalysisResult {
  decision: Decision;
  matchScore: number;
  matchedPoints: string[];
  riskPoints: string[];
  manualReviewRequired: boolean;
}
