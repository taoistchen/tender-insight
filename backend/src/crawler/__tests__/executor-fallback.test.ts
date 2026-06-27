import { afterEach, describe, expect, it, vi } from "vitest";
import { CrawlerService } from "../service.js";
import { DirectFetchExecutor } from "../executors/direct-fetch-executor.js";
import {
  CrawlExecutionError,
  type CollectedPage,
  type CrawlExecutor
} from "../executors/types.js";
import type { CrawlSource } from "../recipes.js";

const source: CrawlSource = {
  key: "construction",
  name: "Construction",
  url: "https://example.com/list",
  maxPages: 2,
  strategies: ["backend_fetch", "remote_browser"],
  actions: [
    { type: "goto", urlFrom: "source.url" },
    { type: "extractHtml", selector: "body" }
  ],
  selectors: {
    items: "a",
    title: "a",
    detailUrl: "a@href"
  }
};

describe("direct fetch executor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("collects source HTML and records a successful attempt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("<html><body>ok</body></html>", { status: 200 })
      )
    );

    const page = await new DirectFetchExecutor().collectList(source, 1);

    expect(page.strategy).toBe("backend_fetch");
    expect(page.html).toContain("ok");
    expect(page.attempt.status).toBe("succeeded");
  });

  it("returns a structured failure when HTTP is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("blocked", { status: 403 }))
    );

    await expect(new DirectFetchExecutor().collectList(source, 1)).rejects.toMatchObject({
      attempt: {
        strategy: "backend_fetch",
        status: "failed",
        errorCode: "HTTP_ERROR"
      }
    });
  });

  it("classifies abort and timeout failures as timeout", async () => {
    const timeoutError = new Error("operation timed out");
    timeoutError.name = "TimeoutError";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw timeoutError;
      })
    );

    await expect(new DirectFetchExecutor().collectList(source, 1)).rejects.toMatchObject({
      attempt: {
        strategy: "backend_fetch",
        status: "failed",
        errorCode: "TIMEOUT"
      }
    });
  });
});

function collected(
  strategy: "backend_fetch" | "remote_browser",
  html: string
): CollectedPage {
  return {
    strategy,
    url: "https://example.com/list",
    finalUrl: "https://example.com/list",
    html,
    attempt: {
      strategy,
      status: "succeeded",
      url: "https://example.com/list"
    }
  };
}

describe("recipe crawl fallback", () => {
  it("falls back to remote browser after direct fetch fails", async () => {
    const direct: CrawlExecutor = {
      strategy: "backend_fetch",
      collectList: async () => {
        throw new CrawlExecutionError({
          strategy: "backend_fetch",
          status: "failed",
          url: "https://example.com/list",
          errorCode: "NETWORK_RESTRICTED",
          message: "blocked"
        });
      },
      collectDetail: async () => collected("backend_fetch", "<html></html>")
    };

    const remote: CrawlExecutor = {
      strategy: "remote_browser",
      collectList: async () =>
        collected(
          "remote_browser",
          '<html><body><a href="https://example.com/detail">Remote Tender</a></body></html>'
        ),
      collectDetail: async () =>
        collected(
          "remote_browser",
          "<html><body>Remote Tender deadline 2026-12-31</body></html>"
        )
    };

    const service = new CrawlerService(undefined, {
      executors: [direct, remote]
    });

    const job = await service.runRecipeCrawl({
      siteKey: "huaian",
      sourceKey: "construction",
      maxPages: 1
    });

    expect(job.status).toBe("completed");
    expect(
      job.strategyAttempts?.map((attempt) => attempt.status).slice(0, 2)
    ).toEqual(["failed", "succeeded"]);
    expect(job.tendersFound).toBeGreaterThan(0);
  });
});
