import { chromium, type Browser, type Page } from "playwright-core";
import type { CrawlAction, CrawlSource } from "../recipes.js";
import type { CrawlErrorCode, CrawlStrategyAttempt } from "../types.js";
import { BrowserbaseProvider } from "./remote-browser-provider.js";
import {
  CrawlExecutionError,
  type CollectedPage,
  type CrawlExecutor,
  type RemoteBrowserProvider
} from "./types.js";

const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000;
const DEFAULT_SELECTOR_TIMEOUT_MS = 30_000;

interface RemoteBrowserConnection {
  browser: Browser;
  page: Page;
}

type RemoteBrowserConnector = (
  connectUrl: string
) => Promise<RemoteBrowserConnection>;

interface RemoteBrowserExecutorOptions {
  provider?: RemoteBrowserProvider;
  connector?: RemoteBrowserConnector;
}

type ConnectOverCdp = (connectUrl: string) => Promise<Browser>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function inferRemoteErrorCode(error: unknown): CrawlErrorCode {
  const normalizedMessage = errorMessage(error).toLowerCase();
  const name = error instanceof Error ? error.name.toLowerCase() : "";

  if (name.includes("timeout") || normalizedMessage.includes("timeout")) {
    return "TIMEOUT";
  }

  return "REMOTE_BROWSER_UNAVAILABLE";
}

function selectorFailure(url: string, selector: string, error: unknown): never {
  throw new CrawlExecutionError({
    strategy: "remote_browser",
    status: "failed",
    url,
    errorCode: "SELECTOR_NOT_FOUND",
    message: `Selector not found (${selector}): ${errorMessage(error)}`
  });
}

export async function createRemoteBrowserConnection(
  connectUrl: string,
  connectOverCdp: ConnectOverCdp
): Promise<RemoteBrowserConnection> {
  let browser: Browser | undefined;

  try {
    browser = await connectOverCdp(connectUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());

    return { browser, page };
  } catch (error) {
    if (browser) {
      await browser.close().catch(() => undefined);
    }

    throw error;
  }
}

function defaultConnector(
  connectUrl: string
): Promise<RemoteBrowserConnection> {
  return createRemoteBrowserConnection(connectUrl, (url) =>
    chromium.connectOverCDP(url)
  );
}

export class RemoteBrowserExecutor implements CrawlExecutor {
  readonly strategy = "remote_browser" as const;

  private readonly provider: RemoteBrowserProvider;
  private readonly connector: RemoteBrowserConnector;

  constructor(options: RemoteBrowserExecutorOptions = {}) {
    this.provider = options.provider ?? new BrowserbaseProvider();
    this.connector = options.connector ?? defaultConnector;
  }

  collectList(source: CrawlSource, page: number): Promise<CollectedPage> {
    void page;
    return this.collect(source.url, source.actions);
  }

  collectDetail(url: string): Promise<CollectedPage> {
    return this.collect(url, [
      { type: "goto", urlFrom: "source.url" },
      { type: "waitForSelector", selector: "body" },
      { type: "extractHtml", selector: "body" }
    ]);
  }

  private async collect(
    url: string,
    actions: CrawlAction[]
  ): Promise<CollectedPage> {
    let browser: Browser | undefined;
    let sessionId: string | undefined;

    try {
      const session = await this.provider.createSession();
      sessionId = session.sessionId;
      const connection = await this.connector(session.connectUrl);
      browser = connection.browser;

      for (const action of actions) {
        await this.runAction(connection.page, url, action);
      }

      const html = await connection.page.content();
      const finalUrl = connection.page.url();
      const title = await connection.page.title();
      const attempt: CrawlStrategyAttempt = {
        strategy: this.strategy,
        status: "succeeded",
        url
      };

      return {
        strategy: this.strategy,
        url,
        finalUrl,
        title,
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
        errorCode: inferRemoteErrorCode(error),
        message: String(error)
      });
    } finally {
      if (browser) {
        await browser.close().catch(() => undefined);
      }

      if (sessionId) {
        await this.provider.closeSession(sessionId).catch(() => undefined);
      }
    }
  }

  private async runAction(
    page: Page,
    url: string,
    action: CrawlAction
  ): Promise<void> {
    switch (action.type) {
      case "goto":
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: DEFAULT_NAVIGATION_TIMEOUT_MS
        });
        return;
      case "waitForSelector":
        try {
          await page.waitForSelector(action.selector, {
            timeout: action.timeoutMs ?? DEFAULT_SELECTOR_TIMEOUT_MS
          });
          return;
        } catch (error) {
          selectorFailure(url, action.selector, error);
        }
      case "click":
        await page.click(action.selector, {
          timeout: action.timeoutMs ?? DEFAULT_SELECTOR_TIMEOUT_MS
        });
        return;
      case "scrollToBottom":
        for (let index = 0; index < action.times; index += 1) {
          await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
          });
        }
        return;
      case "extractHtml":
        try {
          await page.waitForSelector(action.selector, {
            timeout: DEFAULT_SELECTOR_TIMEOUT_MS
          });
          return;
        } catch (error) {
          selectorFailure(url, action.selector, error);
        }
    }
  }
}
