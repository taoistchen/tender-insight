import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserbaseProvider } from "../executors/remote-browser-provider.js";
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

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

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

  it("returns selector diagnostics when a wait action times out", async () => {
    const page = {
      goto: vi.fn(async () => undefined),
      waitForSelector: vi.fn(async () => {
        throw new Error("Timeout 1000ms exceeded while waiting for selector .list");
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

  it("returns remote browser diagnostics when a wait action fails because the page closed", async () => {
    const page = {
      goto: vi.fn(async () => undefined),
      waitForSelector: vi.fn(async () => {
        throw new Error("Protocol error: Target page, context or browser has been closed");
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
        errorCode: "REMOTE_BROWSER_UNAVAILABLE"
      }
    });
  });

  it("returns selector diagnostics when a click action times out", async () => {
    const clickSource: CrawlSource = {
      ...source,
      actions: [
        { type: "goto", urlFrom: "source.url" },
        { type: "click", selector: ".next", timeoutMs: 1000 }
      ]
    };
    const page = {
      goto: vi.fn(async () => undefined),
      waitForSelector: vi.fn(async () => undefined),
      click: vi.fn(async () => {
        throw new Error("Timeout 1000ms exceeded while waiting for selector .next");
      }),
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

    await expect(executor.collectList(clickSource, 1)).rejects.toMatchObject({
      attempt: {
        strategy: "remote_browser",
        status: "failed",
        errorCode: "SELECTOR_NOT_FOUND"
      }
    });
  });

  it("returns remote browser diagnostics when a click action fails because the page closed", async () => {
    const clickSource: CrawlSource = {
      ...source,
      actions: [
        { type: "goto", urlFrom: "source.url" },
        { type: "click", selector: ".next", timeoutMs: 1000 }
      ]
    };
    const page = {
      goto: vi.fn(async () => undefined),
      waitForSelector: vi.fn(async () => undefined),
      click: vi.fn(async () => {
        throw new Error("Protocol error: Target page, context or browser has been closed");
      }),
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

    await expect(executor.collectList(clickSource, 1)).rejects.toMatchObject({
      attempt: {
        strategy: "remote_browser",
        status: "failed",
        errorCode: "REMOTE_BROWSER_UNAVAILABLE"
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

describe("browserbase provider", () => {
  it("sends a best-effort session release request", async () => {
    vi.stubEnv("BROWSERBASE_API_KEY", "key-1");
    const fetch = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetch);

    await expect(
      new BrowserbaseProvider().closeSession("session/1")
    ).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledWith(
      "https://api.browserbase.com/v1/sessions/session%2F1",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-BB-API-Key": "key-1"
        },
        body: JSON.stringify({ status: "REQUEST_RELEASE" })
      }
    );
  });

  it("does not throw when session release cannot run or fails", async () => {
    const provider = new BrowserbaseProvider();

    await expect(provider.closeSession("missing-key")).resolves.toBeUndefined();

    vi.stubEnv("BROWSERBASE_API_KEY", "key-1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network failed");
      })
    );

    await expect(provider.closeSession("fetch-fails")).resolves.toBeUndefined();

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));

    await expect(provider.closeSession("delete-fails")).resolves.toBeUndefined();
  });
});
