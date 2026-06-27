import type { TenderNotice } from "../domain/types.js";
import type { ExtractedTenderFields } from "../tender/extract-tender-fields.js";

/** Raw list item scraped from a tender listing page. */
export interface TenderListItem {
  /** Unique section/notice identifier from the source site. */
  sectionNo: string;
  /** Project name as shown on the listing page. */
  projectName: string;
  /** Section/package name. */
  sectionName: string;
  /** Budget amount in yuan (converted from万元 if needed). */
  budgetAmount?: number;
  /** Publish date string from the listing. */
  publishDate: string;
  /** Absolute URL to the detail page. */
  detailUrl: string;
  /** Source site identifier. */
  sourceSite: string;
}

/** Result of crawling one page of a tender listing. */
export interface CrawlPageResult {
  items: TenderListItem[];
  totalPages: number;
  currentPage: number;
}

/**
 * Site-specific crawler must implement this interface.
 * Each government tender platform gets its own implementation.
 */
export interface TenderCrawler {
  /** Human-readable site name, e.g. "南京市公共资源交易平台". */
  readonly siteName: string;
  /** City name for the company preference filter. */
  readonly city: string;
  /**
   * Fetch one page of the tender listing.
   * @param page Page number starting from 1
   */
  fetchList(page?: number): Promise<CrawlPageResult>;
  /**
   * Fetch and parse a single tender detail page.
   * Returns a TenderNotice domain object ready for analysis.
   */
  fetchDetail(item: TenderListItem): Promise<TenderNotice>;
}

/** Status of a crawl job. */
export interface CrawlJob {
  id: string;
  siteName: string;
  status: "running" | "completed" | "failed" | "skipped";
  startedAt: Date;
  completedAt?: Date;
  pagesTotal: number;
  pagesCrawled: number;
  tendersFound: number;
  tendersNew: number;
  errorCode?: string;
  error?: string;
  recommendedAction?: string;
}

export interface CrawlerUnavailableOptions {
  code:
    | "NETWORK_RESTRICTED"
    | "SEARCH_INDEX_EMPTY"
    | "PLATFORM_UNAVAILABLE";
  message: string;
  recommendedAction: string;
}

export class CrawlerUnavailableError extends Error {
  readonly code: CrawlerUnavailableOptions["code"];
  readonly recommendedAction: string;

  constructor(options: CrawlerUnavailableOptions) {
    super(options.message);
    this.name = "CrawlerUnavailableError";
    this.code = options.code;
    this.recommendedAction = options.recommendedAction;
  }
}
