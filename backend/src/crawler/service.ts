import { analyzeTender } from "../analysis/analyze-tender.js";
import { seedCompanyProfile } from "../seed/company-profile.js";
import type { TenderNotice } from "../domain/types.js";
import type { TenderAnalysisResult } from "../domain/types.js";
import { NanjingCrawler } from "./sites/nanjing.js";
import { LianyungangCrawler } from "./sites/lianyungang.js";
import { ZhenjiangCrawler, setKimiApiKey } from "./sites/zhenjiang.js";
import { HuaianCrawler } from "./sites/huaian.js";
import type { CrawlJob, TenderCrawler, TenderListItem } from "./types.js";

/** A tender with its analysis result, as returned by the API. */
export interface EnrichedTender {
  city: string;
  url: string;
  title: string;
  budgetAmount?: number;
  deadlineTime?: Date;
  qualificationRequirements: { name: string; level: string }[];
  personnelRequirements?: string[];
  performanceRequirements?: string[];
  analysis: TenderAnalysisResult;
}

/**
 * In-memory tender store + crawl orchestrator.
 *
 * In production this would be backed by PostgreSQL (already defined in
 * docker-compose.yml).  For the MVP the in-memory store avoids DB
 * complexity while the rest of the system stabilizes.
 */
class CrawlerService {
  private tenders: Map<string, EnrichedTender> = new Map();
  private jobs: CrawlJob[] = [];
  private crawlers: TenderCrawler[] = [];

  constructor() {
    // Inject Kimi API key for captcha solving
    const kimiKey = process.env["KIMI_API_KEY"] ?? "";
    if (kimiKey) setKimiApiKey(kimiKey);

    this.crawlers.push(new NanjingCrawler());
    this.crawlers.push(new LianyungangCrawler());
    this.crawlers.push(new ZhenjiangCrawler());
    this.crawlers.push(new HuaianCrawler());
  }

  /* ─── Public API ─── */

  /** Return all crawled tenders with analysis, newest first. */
  getAllTenders(): EnrichedTender[] {
    return [...this.tenders.values()].sort((a, b) => {
      const da = a.deadlineTime?.getTime() ?? 0;
      const db = b.deadlineTime?.getTime() ?? 0;
      return db - da;
    });
  }

  /** Return a single crawler's status info. */
  getCrawlers(): { siteName: string; city: string }[] {
    return this.crawlers.map((c) => ({
      siteName: c.siteName,
      city: c.city
    }));
  }

  /** Return recent crawl jobs. */
  getJobs(): CrawlJob[] {
    return [...this.jobs].sort(
      (a, b) => b.startedAt.getTime() - a.startedAt.getTime()
    );
  }

  /** Trigger a crawl for a specific site. */
  async runCrawl(
    siteName?: string,
    maxPages = 3
  ): Promise<CrawlJob> {
    const crawler = siteName
      ? this.crawlers.find((c) => c.siteName === siteName)
      : this.crawlers[0];

    if (!crawler) {
      throw new Error(`Unknown crawler: ${siteName ?? "none"}`);
    }

    const job: CrawlJob = {
      id: `crawl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      siteName: crawler.siteName,
      status: "running",
      startedAt: new Date(),
      pagesTotal: maxPages,
      pagesCrawled: 0,
      tendersFound: 0,
      tendersNew: 0
    };
    this.jobs.unshift(job);

    try {
      for (let page = 1; page <= maxPages; page++) {
        const result = await crawler.fetchList(page);
        job.pagesTotal = Math.min(result.totalPages, maxPages);
        job.pagesCrawled = page;

        for (const item of result.items) {
          job.tendersFound++;
          if (this.tenders.has(item.detailUrl)) continue;

          try {
            const tender = await crawler.fetchDetail(item);
            const analysis = analyzeTender(tender, seedCompanyProfile);
            this.tenders.set(tender.url, { ...tender, analysis });
            job.tendersNew++;
          } catch (err) {
            // Individual detail fetch failure is non-fatal
            console.warn(
              `Failed to fetch detail for ${item.detailUrl}: ${String(err)}`
            );
          }
        }
      }

      job.status = "completed";
    } catch (err) {
      job.status = "failed";
      job.error = String(err);
    }

    job.completedAt = new Date();
    return job;
  }

  /** Number of tenders currently in store. */
  get count(): number {
    return this.tenders.size;
  }
}

/** Singleton — shared across all route modules. */
export const crawlerService = new CrawlerService();
