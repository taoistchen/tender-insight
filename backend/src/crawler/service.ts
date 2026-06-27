import { analyzeTender } from "../analysis/analyze-tender.js";
import { seedCompanyProfile } from "../seed/company-profile.js";
import type { TenderNotice } from "../domain/types.js";
import type { TenderAnalysisResult } from "../domain/types.js";
import { NanjingCrawler } from "./sites/nanjing.js";
import { LianyungangCrawler } from "./sites/lianyungang.js";
import { ZhenjiangCrawler, setKimiApiKey } from "./sites/zhenjiang.js";
import { HuaianCrawler } from "./sites/huaian.js";
import { initSchema } from "../db/schema.js";
import {
  getCompanyProfileForAnalysis,
  seedIfEmpty
} from "../db/company-repo.js";
import {
  upsertTender,
  getAllTenders as dbGetAllTenders,
  loadRequirements,
  getTenderCount
} from "../db/tender-repo.js";
import { CrawlerUnavailableError } from "./types.js";
import type { CrawlJob, TenderCrawler, TenderListItem } from "./types.js";

/** A tender with its analysis result, as returned by the API. */
export interface EnrichedTender {
  city: string;
  url: string;
  title: string;
  contentText?: string;
  budgetAmount?: number;
  deadlineTime?: Date;
  qualificationRequirements: { name: string; level: string }[];
  personnelRequirements?: string[];
  performanceRequirements?: string[];
  sourceHtml?: string;
  resolvedLinks?: TenderNotice["resolvedLinks"];
  attachments?: TenderNotice["attachments"];
  documentTexts?: string[];
  analysis: TenderAnalysisResult;
}

/**
 * Crawl orchestrator backed by PostgreSQL.
 *
 * Falls back to in-memory only if the database is unreachable at startup.
 */
class CrawlerService {
  private tenders: Map<string, EnrichedTender> = new Map();
  private jobs: CrawlJob[] = [];
  private crawlers: TenderCrawler[] = [];
  private dbReady = false;

  constructor(crawlers?: TenderCrawler[]) {
    const kimiKey = process.env["KIMI_API_KEY"] ?? "";
    if (kimiKey) setKimiApiKey(kimiKey);

    this.crawlers =
      crawlers ?? [
        new NanjingCrawler(),
        new LianyungangCrawler(),
        new ZhenjiangCrawler(),
        new HuaianCrawler()
      ];
  }

  /** Call once at startup. Initialises DB schema and loads existing data. */
  async init(): Promise<void> {
    try {
      await initSchema();
      await seedIfEmpty();
      this.dbReady = true;
      const count = await getTenderCount();
      console.log(`CrawlerService: PostgreSQL ready, ${count} tenders stored`);
    } catch (err) {
      console.warn(
        `CrawlerService: PostgreSQL unavailable (${String(err)}), using in-memory store`
      );
      this.dbReady = false;
    }
  }

  /* ─── Public API ─── */

  async getAllTenders(): Promise<EnrichedTender[]> {
    if (this.dbReady) {
      try {
        const tenders = await dbGetAllTenders();
        await loadRequirements(tenders);
        return tenders;
      } catch (err) {
        console.warn("DB read failed, falling back to memory:", String(err));
      }
    }
    return [...this.tenders.values()].sort((a, b) => {
      const da = a.deadlineTime?.getTime() ?? 0;
      const db = b.deadlineTime?.getTime() ?? 0;
      return db - da;
    });
  }

  getCrawlers(): { siteName: string; city: string }[] {
    return this.crawlers.map((c) => ({
      siteName: c.siteName,
      city: c.city
    }));
  }

  getJobs(): CrawlJob[] {
    return [...this.jobs].sort(
      (a, b) => b.startedAt.getTime() - a.startedAt.getTime()
    );
  }

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
      const companyProfile = await this.getCompanyProfile();
      for (let page = 1; page <= maxPages; page++) {
        const result = await crawler.fetchList(page);
        job.pagesTotal = Math.min(result.totalPages, maxPages);
        job.pagesCrawled = page;

        for (const item of result.items) {
          job.tendersFound++;

          try {
            const tender = await crawler.fetchDetail(item);
            const analysis = analyzeTender(tender, companyProfile);
            const enriched: EnrichedTender = { ...tender, analysis };

            // Persist to PostgreSQL (upsert dedup by URL)
            if (this.dbReady) {
              const { saved, isNew } = await upsertTender(enriched);
              if (saved && isNew) job.tendersNew++;
            } else {
              // In-memory fallback
              if (!this.tenders.has(tender.url)) {
                this.tenders.set(tender.url, enriched);
                job.tendersNew++;
              }
            }
          } catch (err) {
            console.warn(
              `Failed to fetch detail for ${item.detailUrl}: ${String(err)}`
            );
          }
        }
      }

      job.status = "completed";
    } catch (err) {
      if (err instanceof CrawlerUnavailableError) {
        job.status = "skipped";
        job.errorCode = err.code;
        job.error = err.message;
        job.recommendedAction = err.recommendedAction;
        job.completedAt = new Date();
        return job;
      }

      job.status = "failed";
      job.error = String(err);
    }

    job.completedAt = new Date();
    return job;
  }

  private async getCompanyProfile() {
    if (!this.dbReady) return seedCompanyProfile;

    try {
      return (await getCompanyProfileForAnalysis()) ?? seedCompanyProfile;
    } catch (err) {
      console.warn(
        `Failed to load company profile from DB, using seed data: ${String(err)}`
      );
      return seedCompanyProfile;
    }
  }

  get count(): number {
    return this.tenders.size;
  }
}

export const crawlerService = new CrawlerService();
export { CrawlerService };
