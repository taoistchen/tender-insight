import { afterEach, describe, expect, it, vi } from "vitest";
import { DirectFetchExecutor } from "../executors/direct-fetch-executor.js";
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
