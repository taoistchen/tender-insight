import { analyzeTender } from "../analysis/analyze-tender.js";
import { seedCompanyProfile } from "../seed/company-profile.js";
import type { TenderNotice } from "../domain/types.js";
import type { TenderAnalysisResult } from "../domain/types.js";
import { extractTenderFields } from "../tender/extract-tender-fields.js";
import { NanjingCrawler } from "./sites/nanjing.js";
import { LianyungangCrawler } from "./sites/lianyungang.js";
import { ZhenjiangCrawler, setKimiApiKey } from "./sites/zhenjiang.js";
import { HuaianCrawler } from "./sites/huaian.js";
import { DirectFetchExecutor } from "./executors/direct-fetch-executor.js";
import { RemoteBrowserExecutor } from "./executors/remote-browser-executor.js";
import {
  CrawlExecutionError,
  type CollectedPage,
  type CrawlExecutor
} from "./executors/types.js";
import {
  getCrawlerRecipes,
  resolveRecipeSource,
  type CrawlSource
} from "./recipes.js";
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
import type {
  CrawlJob,
  CrawlStrategy,
  CrawlStrategyAttempt,
  TenderCrawler,
  TenderListItem
} from "./types.js";

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

interface CrawlerServiceOptions {
  executors?: CrawlExecutor[];
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
  private executors: CrawlExecutor[] = [];
  private dbReady = false;

  constructor(crawlers?: TenderCrawler[], options: CrawlerServiceOptions = {}) {
    const kimiKey = process.env["KIMI_API_KEY"] ?? "";
    if (kimiKey) setKimiApiKey(kimiKey);

    this.crawlers =
      crawlers ?? [
        new NanjingCrawler(),
        new LianyungangCrawler(),
        new ZhenjiangCrawler(),
        new HuaianCrawler()
      ];
    this.executors = options.executors ?? [
      new DirectFetchExecutor(),
      new RemoteBrowserExecutor()
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

  getRecipes() {
    return getCrawlerRecipes();
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

  async runRecipeCrawl({
    siteKey,
    sourceKey,
    maxPages
  }: {
    siteKey: string;
    sourceKey: string;
    maxPages?: number;
  }): Promise<CrawlJob> {
    const { recipe, source, maxPages: resolvedMaxPages } = resolveRecipeSource({
      siteKey,
      sourceKey,
      requestedMaxPages: maxPages
    });

    const job: CrawlJob = {
      id: `crawl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      siteName: recipe.siteName,
      siteKey: recipe.siteKey,
      sourceKey: source.key,
      status: "running",
      startedAt: new Date(),
      pagesTotal: resolvedMaxPages,
      pagesCrawled: 0,
      tendersFound: 0,
      tendersNew: 0,
      strategyAttempts: []
    };
    this.jobs.unshift(job);

    try {
      const companyProfile = await this.getCompanyProfile();

      for (let page = 1; page <= resolvedMaxPages; page++) {
        const collectedList = await this.collectWithFallback(source, page, job);
        job.pagesCrawled = page;

        const items = extractRecipeListItems(collectedList.html, source);
        for (const item of items) {
          job.tendersFound++;

          try {
            const collectedDetail = await this.collectDetailWithFallback(
              item.detailUrl,
              source,
              job
            );
            const tender = this.buildTenderFromCollected(
              recipe.city,
              item,
              collectedDetail.html
            );
            const analysis = analyzeTender(tender, companyProfile);
            const enriched: EnrichedTender = { ...tender, analysis };

            if (this.dbReady) {
              const { saved, isNew } = await upsertTender(enriched);
              if (saved && isNew) job.tendersNew++;
            } else if (!this.tenders.has(tender.url)) {
              this.tenders.set(tender.url, enriched);
              job.tendersNew++;
            }
          } catch (err) {
            console.warn(
              `Failed to fetch recipe detail for ${item.detailUrl}: ${String(err)}`
            );
          }
        }
      }

      job.status = "completed";
    } catch (err) {
      if (job.tendersFound > 0) {
        job.status = "completed";
      } else {
        job.status = "failed";
        job.error = String(err);
      }
    } finally {
      job.completedAt = new Date();
    }

    return job;
  }

  private async collectWithFallback(
    source: CrawlSource,
    page: number,
    job: CrawlJob
  ): Promise<CollectedPage> {
    let lastError: unknown;

    for (const strategy of source.strategies) {
      const executor = this.executorFor(strategy);
      if (!executor) {
        job.strategyAttempts?.push({
          strategy,
          status: "skipped",
          url: source.url,
          message: `No executor configured for ${strategy}`
        });
        continue;
      }

      try {
        const collected = await executor.collectList(source, page);
        job.strategyAttempts?.push(collected.attempt);
        return collected;
      } catch (err) {
        lastError = err;
        job.strategyAttempts?.push(
          this.attemptFromError(err, executor.strategy, source.url)
        );
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`All crawl strategies failed for ${source.url}`);
  }

  private async collectDetailWithFallback(
    url: string,
    source: CrawlSource,
    job: CrawlJob
  ): Promise<CollectedPage> {
    let lastError: unknown;
    let lastAttempt: CrawlStrategyAttempt | undefined;

    for (const strategy of source.strategies) {
      const executor = this.executorFor(strategy);
      if (!executor) {
        lastAttempt = {
          strategy,
          status: "skipped",
          url,
          message: `No executor configured for ${strategy}`
        };
        job.strategyAttempts?.push(lastAttempt);
        continue;
      }

      try {
        const collected = await executor.collectDetail(url);
        job.strategyAttempts?.push(collected.attempt);
        return collected;
      } catch (err) {
        lastError = err;
        lastAttempt = this.attemptFromError(err, executor.strategy, url);
        job.strategyAttempts?.push(lastAttempt);
      }
    }

    const detailFailure: CrawlStrategyAttempt = {
      strategy: lastAttempt?.strategy ?? source.strategies[0],
      status: "failed",
      url,
      errorCode: "DETAIL_FETCH_FAILED",
      message: lastError instanceof Error ? lastError.message : String(lastError)
    };
    job.strategyAttempts?.push(detailFailure);

    throw new CrawlExecutionError(detailFailure);
  }

  private buildTenderFromCollected(
    city: string,
    item: TenderListItem,
    html: string
  ): TenderNotice {
    const title = extractTitle(html) ?? item.projectName;
    const contentText = `${title}\nPublished: ${item.publishDate}\n${stripTags(html)}`
      .replace(/\s+\n/g, "\n")
      .slice(0, 32_768);
    const fields = extractTenderFields(contentText);

    return {
      city,
      url: item.detailUrl,
      title,
      sourceHtml: html,
      contentText,
      budgetAmount: fields.budgetAmount ?? item.budgetAmount,
      deadlineTime: fields.deadlineTime,
      qualificationRequirements: fields.qualificationRequirements,
      personnelRequirements: fields.personnelRequirements,
      performanceRequirements: fields.performanceRequirements
    };
  }

  private executorFor(strategy: CrawlStrategy): CrawlExecutor | undefined {
    return this.executors.find((executor) => executor.strategy === strategy);
  }

  private attemptFromError(
    err: unknown,
    strategy: CrawlStrategy,
    url: string
  ): CrawlStrategyAttempt {
    if (err instanceof CrawlExecutionError) {
      return err.attempt;
    }

    return {
      strategy,
      status: "failed",
      url,
      errorCode: "NETWORK_RESTRICTED",
      message: err instanceof Error ? err.message : String(err)
    };
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

function extractRecipeListItems(
  html: string,
  source: CrawlSource
): TenderListItem[] {
  const items: TenderListItem[] = [];
  const anchorRegex =
    /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorRegex.exec(html)) !== null) {
    const title = stripTags(match[2]).replace(/\s+/g, " ").trim();
    if (!title) {
      continue;
    }

    try {
      const detailUrl = new URL(match[1], source.url).toString();
      items.push({
        sectionNo: detailUrl,
        projectName: title,
        sectionName: "",
        publishDate: "",
        detailUrl,
        sourceSite: source.name
      });
    } catch {
      continue;
    }
  }

  return items;
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = match ? stripTags(match[1]).replace(/\s+/g, " ").trim() : "";
  return title || undefined;
}

function stripTags(input: string): string {
  return input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
