import { describe, expect, it, vi } from "vitest";
import {
  createRemoteBrowserConnection,
  RemoteBrowserExecutor
} from "../executors/remote-browser-executor.js";
import type { RemoteBrowserProvider } from "../executors/types.js";
import type { CrawlSource } from "../recipes.js";

const source: CrawlSource = {
  key: "construction",
  name: "Construction",
  url: "https://example.com/list",
  maxPages: 1,
  strategies: ["remote_browser"],
  actions: [
    { type: "goto", urlFrom: "source.url" },
    { type: "waitForSelector", selector: ".list", timeoutMs: 1000 },
    { type: "extractHtml", selector: "body" }
  ],
  selectors: {
    items: "a",
    title: "a",
    detailUrl: "a@href"
  }
};

function makeProvider(): RemoteBrowserProvider {
  return {
    createSession: vi.fn(async () => ({
      sessionId: "session-1",
      connectUrl: "ws://example.test"
    })),
    closeSession: vi.fn(async () => undefined)
  };
}

describe("remote browser executor", () => {
  it("runs recipe actions and returns extracted HTML", async () => {
    const page = {
      goto: vi.fn(async () => undefined),
      waitForSelector: vi.fn(async () => undefined),
      click: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => undefined),
      content: vi.fn(
        async () => '<html><body><div class="list">ok</div></body></html>'
      ),
      title: vi.fn(async () => "List"),
      url: vi.fn(() => "https://example.com/list")
    };
    const browser = { close: vi.fn(async () => undefined) };

    const executor = new RemoteBrowserExecutor({
      provider: makeProvider(),
      connector: async () => ({ browser: browser as never, page: page as never })
    });

    const result = await executor.collectList(source, 1);

    expect(page.goto).toHaveBeenCalledWith(source.url, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });
    expect(page.waitForSelector).toHaveBeenCalledWith(".list", {
      timeout: 1000
    });
    expect(result.strategy).toBe("remote_browser");
    expect(result.html).toContain("ok");
    expect(result.attempt.status).toBe("succeeded");
  });

  it("returns selector diagnostics when a wait action fails", async () => {
    const page = {
      goto: vi.fn(async () => undefined),
      waitForSelector: vi.fn(async () => {
        throw new Error("missing selector");
      }),
      click: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => undefined),
      content: vi.fn(async () => "<html></html>"),
      title: vi.fn(async () => "List"),
      url: vi.fn(() => "https://example.com/list")
    };
    const browser = { close: vi.fn(async () => undefined) };

    const executor = new RemoteBrowserExecutor({
      provider: makeProvider(),
      connector: async () => ({ browser: browser as never, page: page as never })
    });

    await expect(executor.collectList(source, 1)).rejects.toMatchObject({
      attempt: {
        strategy: "remote_browser",
        status: "failed",
        errorCode: "SELECTOR_NOT_FOUND"
      }
    });
  });

  it("closes a partially connected browser when page setup fails", async () => {
    const setupError = new Error("new context failed");
    const browser = {
      close: vi.fn(async () => undefined),
      contexts: vi.fn(() => []),
      newContext: vi.fn(async () => {
        throw setupError;
      })
    };

    await expect(
      createRemoteBrowserConnection(
        "ws://example.test",
        async () => browser as never
      )
    ).rejects.toBe(setupError);

    expect(browser.close).toHaveBeenCalledOnce();
  });
});
