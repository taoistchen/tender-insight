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

afterEach(() => {
  vi.doUnmock("../recipes.js");
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("direct fetch executor", () => {
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
          '<html><body><div class="ewb-list-node"><a href="https://example.com/detail">Remote Tender</a></div></body></html>'
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

  it("caps recipe crawls to one page even if a source has pagination-like metadata", async () => {
    vi.resetModules();
    vi.doMock("../recipes.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../recipes.js")>();
      return {
        ...actual,
        resolveRecipeSource: () => ({
          recipe: {
            siteKey: "huaian",
            siteName: "Huai'an Public Resources Trading Center",
            city: "Huaian",
            enabled: true,
            sources: []
          },
          source: {
            ...source,
            maxPages: 2,
            pagination: { type: "page" }
          },
          maxPages: 2
        })
      };
    });

    const { CrawlerService: MockedCrawlerService } = await import("../service.js");

    let listCollections = 0;
    const direct: CrawlExecutor = {
      strategy: "backend_fetch",
      collectList: async () => {
        listCollections++;
        return collected(
          "backend_fetch",
          '<html><body><a href="https://example.com/detail">First Tender</a></body></html>'
        );
      },
      collectDetail: async () =>
        collected("backend_fetch", "<html><body>First Tender</body></html>")
    };

    const service = new MockedCrawlerService(undefined, {
      executors: [direct]
    });

    const job = await service.runRecipeCrawl({
      siteKey: "huaian",
      sourceKey: "construction",
      maxPages: 2
    });

    expect(job.status).toBe("completed");
    expect(job.pagesTotal).toBe(1);
    expect(job.pagesCrawled).toBe(1);
    expect(job.tendersFound).toBe(1);
    expect(listCollections).toBe(1);
  });

  it("limits current recipes to one list page", async () => {
    let listCollections = 0;
    const direct: CrawlExecutor = {
      strategy: "backend_fetch",
      collectList: async () => {
        listCollections++;
        return collected(
          "backend_fetch",
          '<html><body><div class="ewb-list-node"><a href="https://example.com/detail">Single Tender</a></div></body></html>'
        );
      },
      collectDetail: async () =>
        collected("backend_fetch", "<html><body>Single Tender</body></html>")
    };

    const service = new CrawlerService(undefined, {
      executors: [direct]
    });

    const job = await service.runRecipeCrawl({
      siteKey: "huaian",
      sourceKey: "construction",
      maxPages: 2
    });

    expect(job.status).toBe("completed");
    expect(job.pagesTotal).toBe(1);
    expect(job.pagesCrawled).toBe(1);
    expect(listCollections).toBe(1);
  });

  it("extracts recipe list items only from the configured item selector", async () => {
    const detailUrls: string[] = [];
    const direct: CrawlExecutor = {
      strategy: "backend_fetch",
      collectList: async () =>
        collected(
          "backend_fetch",
          [
            '<html><body>',
            '<nav><a href="https://example.com/nav">Navigation Link</a></nav>',
            '<div class="ewb-list-node">',
            '<a href="https://example.com/detail">Real Tender</a>',
            "</div>",
            '<footer><a href="https://example.com/footer">Footer Link</a></footer>',
            "</body></html>"
          ].join("")
        ),
      collectDetail: async (url) => {
        detailUrls.push(url);
        return collected("backend_fetch", "<html><body>Real Tender</body></html>");
      }
    };

    const service = new CrawlerService(undefined, {
      executors: [direct]
    });

    const job = await service.runRecipeCrawl({
      siteKey: "huaian",
      sourceKey: "construction",
      maxPages: 1
    });

    expect(job.status).toBe("completed");
    expect(job.tendersFound).toBe(1);
    expect(detailUrls).toEqual(["https://example.com/detail"]);
  });
});

describe("crawler run request validation", () => {
  it("rejects partial recipe identifiers", async () => {
    const routeModule = await import("../../routes/crawler.js");
    expect("validateCrawlerRunRequest" in routeModule).toBe(true);
    const validateCrawlerRunRequest = routeModule.validateCrawlerRunRequest as (
      body: unknown
    ) => { ok: boolean; error?: string };

    expect(validateCrawlerRunRequest({ siteKey: "huaian" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("siteKey and sourceKey")
    });
    expect(validateCrawlerRunRequest({ sourceKey: "construction" })).toMatchObject(
      {
        ok: false,
        error: expect.stringContaining("siteKey and sourceKey")
      }
    );
  });

  it("normalizes maxPages to a finite positive capped number", async () => {
    const routeModule = await import("../../routes/crawler.js");
    expect("validateCrawlerRunRequest" in routeModule).toBe(true);
    const validateCrawlerRunRequest = routeModule.validateCrawlerRunRequest as (
      body: unknown
    ) => { ok: true; maxPages: number };

    expect(validateCrawlerRunRequest({ maxPages: Number.NaN })).toMatchObject({
      ok: true,
      maxPages: 3
    });
    expect(validateCrawlerRunRequest({ maxPages: Infinity })).toMatchObject({
      ok: true,
      maxPages: 3
    });
    expect(validateCrawlerRunRequest({ maxPages: 0 })).toMatchObject({
      ok: true,
      maxPages: 3
    });
    expect(validateCrawlerRunRequest({ maxPages: "5" })).toMatchObject({
      ok: true,
      maxPages: 3
    });
    expect(validateCrawlerRunRequest({ maxPages: 50 })).toMatchObject({
      ok: true,
      maxPages: 10
    });
  });
});
