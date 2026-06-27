import type { CrawlSource } from "../recipes.js";
import type { CrawlErrorCode, CrawlStrategyAttempt } from "../types.js";
import {
  CrawlExecutionError,
  type CollectedPage,
  type CrawlExecutor
} from "./types.js";

const FETCH_TIMEOUT_MS = 20_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function classifyFetchError(error: unknown): CrawlErrorCode {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  const normalizedMessage = message.toLowerCase();

  if (
    name === "AbortError" ||
    name === "TimeoutError" ||
    normalizedMessage.includes("timeout") ||
    normalizedMessage.includes("aborted")
  ) {
    return "TIMEOUT";
  }

  return "NETWORK_RESTRICTED";
}

export class DirectFetchExecutor implements CrawlExecutor {
  readonly strategy = "backend_fetch" as const;

  collectList(source: CrawlSource, page: number): Promise<CollectedPage> {
    void page;
    return this.collect(source.url);
  }

  collectDetail(url: string): Promise<CollectedPage> {
    return this.collect(url);
  }

  private async collect(url: string): Promise<CollectedPage> {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });

      if (!response.ok) {
        throw new CrawlExecutionError({
          strategy: this.strategy,
          status: "failed",
          url,
          errorCode: "HTTP_ERROR",
          message: `HTTP ${response.status} while fetching ${url}`
        });
      }

      const html = await response.text();
      const attempt: CrawlStrategyAttempt = {
        strategy: this.strategy,
        status: "succeeded",
        url
      };

      return {
        strategy: this.strategy,
        url,
        finalUrl: response.url || url,
        html,
        attempt
      };
    } catch (error) {
      if (error instanceof CrawlExecutionError) {
        throw error;
      }

      throw new CrawlExecutionError({
        strategy: this.strategy,
        status: "failed",
        url,
        errorCode: classifyFetchError(error),
        message: String(error)
      });
    }
  }
}
