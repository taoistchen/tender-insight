import type { CrawlSource } from "../recipes.js";
import type { CrawlStrategy, CrawlStrategyAttempt } from "../types.js";

export interface CollectedPage {
  strategy: CrawlStrategy;
  url: string;
  finalUrl: string;
  title?: string;
  html: string;
  screenshotPath?: string;
  attempt: CrawlStrategyAttempt;
}

export class CrawlExecutionError extends Error {
  readonly attempt: CrawlStrategyAttempt;

  constructor(attempt: CrawlStrategyAttempt) {
    super(attempt.message ?? `Crawl execution failed: ${attempt.strategy}`);
    this.name = "CrawlExecutionError";
    this.attempt = attempt;
  }
}

export interface CrawlExecutor {
  readonly strategy: CrawlStrategy;
  collectList(source: CrawlSource, page: number): Promise<CollectedPage>;
  collectDetail(url: string): Promise<CollectedPage>;
}

export interface RemoteBrowserSession {
  sessionId: string;
  connectUrl: string;
}

export interface RemoteBrowserProvider {
  createSession(): Promise<RemoteBrowserSession>;
  closeSession(sessionId: string): Promise<void>;
}
