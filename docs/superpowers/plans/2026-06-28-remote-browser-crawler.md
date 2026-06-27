# Remote Browser Crawler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a backend-orchestrated, user-invisible remote browser fallback for configured tender source URLs while preserving existing crawler behavior.

**Architecture:** Add recipe-driven crawl sources and executor boundaries beside the current city crawler interface. Keep existing crawlers as the direct-fetch path, and add a remote browser executor that connects to Browserbase-compatible CDP sessions through `playwright-core`. The frontend only triggers jobs and reads job status; provider credentials remain backend-only.

**Tech Stack:** Node 20, TypeScript, Express, Vitest, Zod, React, Vite, `playwright-core`.

---

## File Structure

- Create `backend/src/crawler/recipes.ts`: typed site recipe model, validation, default remote-browser source definitions, and recipe lookup helpers.
- Create `backend/src/crawler/__tests__/recipes.test.ts`: validates recipe parsing, source lookup, max-page caps, and rejected invalid actions.
- Create `backend/src/crawler/executors/types.ts`: shared executor, collected page, strategy attempt, and remote browser provider interfaces.
- Create `backend/src/crawler/executors/direct-fetch-executor.ts`: direct HTTP page collector for configured sources.
- Create `backend/src/crawler/executors/remote-browser-provider.ts`: Browserbase session provider using backend environment variables.
- Create `backend/src/crawler/executors/remote-browser-executor.ts`: Playwright CDP remote browser executor that runs bounded recipe actions.
- Create `backend/src/crawler/__tests__/executor-fallback.test.ts`: mocked executor tests for fallback and diagnostics.
- Create `backend/src/crawler/__tests__/remote-browser-executor.test.ts`: mocked browser provider tests for action execution and failure diagnostics.
- Modify `backend/src/crawler/types.ts`: add crawl strategy, recipe job fields, and structured strategy attempt types to `CrawlJob`.
- Modify `backend/src/crawler/service.ts`: add recipe lookup APIs and recipe-based crawl execution with fallback.
- Modify `backend/src/routes/crawler.ts`: expose recipes and accept recipe-source crawl requests.
- Modify `backend/package.json` and `package-lock.json`: add `playwright-core`.
- Modify `frontend/src/App.tsx`: add crawl center mode, recipe/job state, and crawl trigger.
- Modify `frontend/src/styles.css`: style crawl center controls and job status rows.

---

### Task 1: Recipe Model And Validation

**Files:**
- Create: `backend/src/crawler/recipes.ts`
- Test: `backend/src/crawler/__tests__/recipes.test.ts`

- [ ] **Step 1: Write the failing recipe tests**

Create `backend/src/crawler/__tests__/recipes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  getCrawlerRecipe,
  getCrawlerRecipes,
  resolveRecipeSource,
  validateSiteRecipe
} from "../recipes.js";

describe("crawler recipes", () => {
  it("exposes the Huaian construction source with remote browser fallback", () => {
    const recipe = getCrawlerRecipe("huaian");

    expect(recipe.siteKey).toBe("huaian");
    expect(recipe.sources[0].key).toBe("construction");
    expect(recipe.sources[0].strategies).toEqual([
      "backend_fetch",
      "remote_browser"
    ]);
  });

  it("resolves a source and caps the requested pages", () => {
    const { source, maxPages } = resolveRecipeSource({
      siteKey: "huaian",
      sourceKey: "construction",
      requestedMaxPages: 50
    });

    expect(source.key).toBe("construction");
    expect(maxPages).toBe(5);
  });

  it("rejects actions without a selector where one is required", () => {
    expect(() =>
      validateSiteRecipe({
        siteKey: "bad",
        siteName: "Bad",
        city: "Bad",
        enabled: true,
        sources: [
          {
            key: "broken",
            name: "Broken",
            url: "https://example.com",
            maxPages: 1,
            strategies: ["remote_browser"],
            actions: [{ type: "waitForSelector" }],
            selectors: {
              items: ".item",
              title: "a",
              detailUrl: "a@href"
            }
          }
        ]
      })
    ).toThrow();
  });

  it("returns all enabled recipes for API responses", () => {
    const recipes = getCrawlerRecipes();

    expect(recipes.some((recipe) => recipe.siteKey === "huaian")).toBe(true);
    expect(recipes.every((recipe) => recipe.enabled)).toBe(true);
  });
});
```

- [ ] **Step 2: Run recipe tests to verify they fail**

Run: `npm run test -w backend -- recipes.test.ts`

Expected: FAIL because `backend/src/crawler/recipes.ts` does not exist.

- [ ] **Step 3: Implement recipe model**

Create `backend/src/crawler/recipes.ts`:

```ts
import { z } from "zod";

export const crawlStrategySchema = z.enum(["backend_fetch", "remote_browser"]);
export type CrawlStrategy = z.infer<typeof crawlStrategySchema>;

export const crawlActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("goto"),
    urlFrom: z.literal("source.url")
  }),
  z.object({
    type: z.literal("waitForSelector"),
    selector: z.string().min(1),
    timeoutMs: z.number().int().positive().max(60_000).optional()
  }),
  z.object({
    type: z.literal("click"),
    selector: z.string().min(1),
    timeoutMs: z.number().int().positive().max(60_000).optional()
  }),
  z.object({
    type: z.literal("scrollToBottom"),
    times: z.number().int().min(1).max(10).default(1)
  }),
  z.object({
    type: z.literal("extractHtml"),
    selector: z.string().min(1)
  })
]);

export type CrawlAction = z.infer<typeof crawlActionSchema>;

export const crawlSelectorsSchema = z.object({
  items: z.string().min(1),
  title: z.string().min(1),
  detailUrl: z.string().min(1),
  publishDate: z.string().min(1).optional(),
  budgetAmount: z.string().min(1).optional()
});

export type CrawlSelectors = z.infer<typeof crawlSelectorsSchema>;

export const crawlSourceSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url(),
  maxPages: z.number().int().min(1).max(20),
  strategies: z.array(crawlStrategySchema).min(1),
  actions: z.array(crawlActionSchema).min(1),
  selectors: crawlSelectorsSchema
});

export type CrawlSource = z.infer<typeof crawlSourceSchema>;

export const siteRecipeSchema = z.object({
  siteKey: z.string().min(1),
  siteName: z.string().min(1),
  city: z.string().min(1),
  enabled: z.boolean(),
  sources: z.array(crawlSourceSchema).min(1)
});

export type SiteRecipe = z.infer<typeof siteRecipeSchema>;

const rawRecipes: SiteRecipe[] = [
  {
    siteKey: "huaian",
    siteName: "Huaian Public Resource Trading Platform",
    city: "Huaian",
    enabled: true,
    sources: [
      {
        key: "construction",
        name: "Construction",
        url: "https://ggzy.huaian.gov.cn/",
        maxPages: 5,
        strategies: ["backend_fetch", "remote_browser"],
        actions: [
          { type: "goto", urlFrom: "source.url" },
          { type: "waitForSelector", selector: "body", timeoutMs: 20_000 },
          { type: "extractHtml", selector: "body" }
        ],
        selectors: {
          items: "a",
          title: "a",
          detailUrl: "a@href",
          publishDate: ".date"
        }
      }
    ]
  }
];

export function validateSiteRecipe(input: unknown): SiteRecipe {
  return siteRecipeSchema.parse(input);
}

export function getCrawlerRecipes(): SiteRecipe[] {
  return rawRecipes.map(validateSiteRecipe).filter((recipe) => recipe.enabled);
}

export function getCrawlerRecipe(siteKey: string): SiteRecipe {
  const recipe = getCrawlerRecipes().find((candidate) => candidate.siteKey === siteKey);
  if (!recipe) throw new Error(`Unknown crawler recipe: ${siteKey}`);
  return recipe;
}

export function resolveRecipeSource(input: {
  siteKey: string;
  sourceKey: string;
  requestedMaxPages?: number;
}): { recipe: SiteRecipe; source: CrawlSource; maxPages: number } {
  const recipe = getCrawlerRecipe(input.siteKey);
  const source = recipe.sources.find((candidate) => candidate.key === input.sourceKey);
  if (!source) {
    throw new Error(`Unknown crawler source: ${input.siteKey}/${input.sourceKey}`);
  }

  const requested = input.requestedMaxPages ?? source.maxPages;
  const maxPages = Math.max(1, Math.min(requested, source.maxPages, 10));
  return { recipe, source, maxPages };
}
```

- [ ] **Step 4: Run recipe tests to verify they pass**

Run: `npm run test -w backend -- recipes.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/crawler/recipes.ts backend/src/crawler/__tests__/recipes.test.ts
git commit -m "feat: add crawler recipe model"
```

---

### Task 2: Executor Contracts And Direct Fetch Executor

**Files:**
- Create: `backend/src/crawler/executors/types.ts`
- Create: `backend/src/crawler/executors/direct-fetch-executor.ts`
- Test: `backend/src/crawler/__tests__/executor-fallback.test.ts`
- Modify: `backend/src/crawler/types.ts`

- [ ] **Step 1: Write failing executor contract tests**

Create `backend/src/crawler/__tests__/executor-fallback.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
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
  it("collects source HTML and records a successful attempt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html><body>ok</body></html>", { status: 200 }))
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
});
```

- [ ] **Step 2: Run executor tests to verify they fail**

Run: `npm run test -w backend -- executor-fallback.test.ts`

Expected: FAIL because executor files do not exist.

- [ ] **Step 3: Extend crawler job types**

Modify `backend/src/crawler/types.ts` by adding these exports above `CrawlJob`:

```ts
export type CrawlStrategy = "backend_fetch" | "remote_browser";

export type CrawlErrorCode =
  | "NETWORK_RESTRICTED"
  | "SEARCH_INDEX_EMPTY"
  | "PLATFORM_UNAVAILABLE"
  | "HTTP_ERROR"
  | "TIMEOUT"
  | "SELECTOR_NOT_FOUND"
  | "EMPTY_RESULT"
  | "REMOTE_BROWSER_UNAVAILABLE"
  | "DETAIL_FETCH_FAILED"
  | "PARSER_FAILED";

export interface CrawlStrategyAttempt {
  strategy: CrawlStrategy;
  status: "succeeded" | "failed" | "skipped";
  url: string;
  errorCode?: CrawlErrorCode;
  message?: string;
  screenshotPath?: string;
}
```

Then add optional recipe fields to `CrawlJob`:

```ts
  siteKey?: string;
  sourceKey?: string;
  strategyAttempts?: CrawlStrategyAttempt[];
```

- [ ] **Step 4: Implement executor contracts**

Create `backend/src/crawler/executors/types.ts`:

```ts
import type { Browser, Page } from "playwright-core";
import type { CrawlSource, CrawlStrategy } from "../recipes.js";
import type { CrawlStrategyAttempt } from "../types.js";

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
    super(attempt.message ?? `${attempt.strategy} failed`);
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

export interface ConnectedBrowser {
  browser: Browser;
  page: Page;
}
```

- [ ] **Step 5: Implement direct fetch executor**

Create `backend/src/crawler/executors/direct-fetch-executor.ts`:

```ts
import type { CrawlSource } from "../recipes.js";
import type { CrawlStrategyAttempt } from "../types.js";
import { CrawlExecutionError, type CollectedPage, type CrawlExecutor } from "./types.js";

export class DirectFetchExecutor implements CrawlExecutor {
  readonly strategy = "backend_fetch" as const;

  async collectList(source: CrawlSource, _page: number): Promise<CollectedPage> {
    return this.collect(source.url);
  }

  async collectDetail(url: string): Promise<CollectedPage> {
    return this.collect(url);
  }

  private async collect(url: string): Promise<CollectedPage> {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"
        },
        signal: AbortSignal.timeout(20_000)
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
    } catch (err) {
      if (err instanceof CrawlExecutionError) throw err;
      throw new CrawlExecutionError({
        strategy: this.strategy,
        status: "failed",
        url,
        errorCode: "NETWORK_RESTRICTED",
        message: String(err)
      });
    }
  }
}
```

- [ ] **Step 6: Run executor tests**

Run: `npm run test -w backend -- executor-fallback.test.ts`

Expected: PASS, 2 tests.

- [ ] **Step 7: Commit**

```bash
git add backend/src/crawler/types.ts backend/src/crawler/executors/types.ts backend/src/crawler/executors/direct-fetch-executor.ts backend/src/crawler/__tests__/executor-fallback.test.ts
git commit -m "feat: add crawler executor contracts"
```

---

### Task 3: Remote Browser Provider And Executor

**Files:**
- Modify: `backend/package.json`
- Modify: `package-lock.json`
- Create: `backend/src/crawler/executors/remote-browser-provider.ts`
- Create: `backend/src/crawler/executors/remote-browser-executor.ts`
- Test: `backend/src/crawler/__tests__/remote-browser-executor.test.ts`

- [ ] **Step 1: Add Playwright Core**

Run: `npm install playwright-core -w backend`

Expected: `backend/package.json` includes `playwright-core`, and `package-lock.json` changes.

- [ ] **Step 2: Write failing remote executor tests**

Create `backend/src/crawler/__tests__/remote-browser-executor.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { RemoteBrowserExecutor } from "../executors/remote-browser-executor.js";
import type { CrawlSource } from "../recipes.js";
import type { RemoteBrowserProvider } from "../executors/types.js";

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
      content: vi.fn(async () => "<html><body><div class=\"list\">ok</div></body></html>"),
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
    expect(page.waitForSelector).toHaveBeenCalledWith(".list", { timeout: 1000 });
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
});
```

- [ ] **Step 3: Run remote executor tests to verify they fail**

Run: `npm run test -w backend -- remote-browser-executor.test.ts`

Expected: FAIL because remote browser executor files do not exist.

- [ ] **Step 4: Implement Browserbase provider**

Create `backend/src/crawler/executors/remote-browser-provider.ts`:

```ts
import type { RemoteBrowserProvider, RemoteBrowserSession } from "./types.js";

interface BrowserbaseSessionResponse {
  id: string;
  connectUrl?: string;
  websocketUrl?: string;
}

export class BrowserbaseProvider implements RemoteBrowserProvider {
  private readonly apiKey = process.env["BROWSERBASE_API_KEY"] ?? "";
  private readonly projectId = process.env["BROWSERBASE_PROJECT_ID"] ?? "";

  async createSession(): Promise<RemoteBrowserSession> {
    if (!this.apiKey || !this.projectId) {
      throw new Error("Browserbase credentials are not configured");
    }

    const response = await fetch("https://api.browserbase.com/v1/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BB-API-Key": this.apiKey
      },
      body: JSON.stringify({
        projectId: this.projectId
      })
    });

    if (!response.ok) {
      throw new Error(`Browserbase session creation failed with HTTP ${response.status}`);
    }

    const data = (await response.json()) as BrowserbaseSessionResponse;
    const connectUrl = data.connectUrl ?? data.websocketUrl;
    if (!data.id || !connectUrl) {
      throw new Error("Browserbase session response did not include connection details");
    }

    return {
      sessionId: data.id,
      connectUrl
    };
  }

  async closeSession(_sessionId: string): Promise<void> {
    return;
  }
}
```

- [ ] **Step 5: Implement remote browser executor**

Create `backend/src/crawler/executors/remote-browser-executor.ts`:

```ts
import { chromium } from "playwright-core";
import type { CrawlAction, CrawlSource } from "../recipes.js";
import { CrawlExecutionError, type CollectedPage, type ConnectedBrowser, type CrawlExecutor, type RemoteBrowserProvider } from "./types.js";
import { BrowserbaseProvider } from "./remote-browser-provider.js";

interface RemoteBrowserExecutorOptions {
  provider?: RemoteBrowserProvider;
  connector?: (connectUrl: string) => Promise<ConnectedBrowser>;
}

export class RemoteBrowserExecutor implements CrawlExecutor {
  readonly strategy = "remote_browser" as const;
  private readonly provider: RemoteBrowserProvider;
  private readonly connector: (connectUrl: string) => Promise<ConnectedBrowser>;

  constructor(options: RemoteBrowserExecutorOptions = {}) {
    this.provider = options.provider ?? new BrowserbaseProvider();
    this.connector = options.connector ?? defaultConnector;
  }

  async collectList(source: CrawlSource, _page: number): Promise<CollectedPage> {
    return this.collect(source.url, source.actions);
  }

  async collectDetail(url: string): Promise<CollectedPage> {
    return this.collect(url, [
      { type: "goto", urlFrom: "source.url" },
      { type: "waitForSelector", selector: "body", timeoutMs: 20_000 },
      { type: "extractHtml", selector: "body" }
    ]);
  }

  private async collect(url: string, actions: CrawlAction[]): Promise<CollectedPage> {
    let sessionId = "";
    let connected: ConnectedBrowser | undefined;

    try {
      const session = await this.provider.createSession();
      sessionId = session.sessionId;
      connected = await this.connector(session.connectUrl);

      for (const action of actions) {
        await runAction(connected.page, url, action);
      }

      const html = await connected.page.content();
      return {
        strategy: this.strategy,
        url,
        finalUrl: connected.page.url(),
        title: await connected.page.title(),
        html,
        attempt: {
          strategy: this.strategy,
          status: "succeeded",
          url
        }
      };
    } catch (err) {
      if (err instanceof CrawlExecutionError) throw err;
      throw new CrawlExecutionError({
        strategy: this.strategy,
        status: "failed",
        url,
        errorCode: inferRemoteErrorCode(err),
        message: String(err)
      });
    } finally {
      if (connected) await connected.browser.close();
      if (sessionId) await this.provider.closeSession(sessionId);
    }
  }
}

async function defaultConnector(connectUrl: string): Promise<ConnectedBrowser> {
  const browser = await chromium.connectOverCDP(connectUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());
  return { browser, page };
}

async function runAction(page: ConnectedBrowser["page"], url: string, action: CrawlAction): Promise<void> {
  try {
    switch (action.type) {
      case "goto":
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        return;
      case "waitForSelector":
        await page.waitForSelector(action.selector, { timeout: action.timeoutMs ?? 20_000 });
        return;
      case "click":
        await page.click(action.selector, { timeout: action.timeoutMs ?? 20_000 });
        return;
      case "scrollToBottom":
        for (let i = 0; i < action.times; i++) {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        }
        return;
      case "extractHtml":
        await page.waitForSelector(action.selector, { timeout: 20_000 });
        return;
    }
  } catch (err) {
    throw new CrawlExecutionError({
      strategy: "remote_browser",
      status: "failed",
      url,
      errorCode:
        action.type === "waitForSelector" || action.type === "extractHtml"
          ? "SELECTOR_NOT_FOUND"
          : "REMOTE_BROWSER_UNAVAILABLE",
      message: String(err)
    });
  }
}

function inferRemoteErrorCode(err: unknown) {
  const message = String(err);
  if (message.toLowerCase().includes("timeout")) return "TIMEOUT";
  return "REMOTE_BROWSER_UNAVAILABLE";
}
```

- [ ] **Step 6: Run remote executor tests**

Run: `npm run test -w backend -- remote-browser-executor.test.ts`

Expected: PASS, 2 tests.

- [ ] **Step 7: Commit**

```bash
git add backend/package.json package-lock.json backend/src/crawler/executors/remote-browser-provider.ts backend/src/crawler/executors/remote-browser-executor.ts backend/src/crawler/__tests__/remote-browser-executor.test.ts
git commit -m "feat: add remote browser executor"
```

---

### Task 4: Recipe-Based Crawl Orchestration And API

**Files:**
- Modify: `backend/src/crawler/service.ts`
- Modify: `backend/src/routes/crawler.ts`
- Test: `backend/src/crawler/__tests__/executor-fallback.test.ts`

- [ ] **Step 1: Add fallback orchestration tests**

Append to `backend/src/crawler/__tests__/executor-fallback.test.ts`:

```ts
import { CrawlerService } from "../service.js";
import { CrawlExecutionError, type CollectedPage, type CrawlExecutor } from "../executors/types.js";

function collected(strategy: "backend_fetch" | "remote_browser", html: string): CollectedPage {
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
    expect(job.strategyAttempts?.map((attempt) => attempt.status)).toEqual([
      "failed",
      "succeeded"
    ]);
    expect(job.tendersFound).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run fallback test to verify it fails**

Run: `npm run test -w backend -- executor-fallback.test.ts`

Expected: FAIL because `CrawlerService` does not accept executor options and `runRecipeCrawl` does not exist.

- [ ] **Step 3: Update `CrawlerService` constructor and recipe APIs**

Modify `backend/src/crawler/service.ts` imports:

```ts
import { DirectFetchExecutor } from "./executors/direct-fetch-executor.js";
import { RemoteBrowserExecutor } from "./executors/remote-browser-executor.js";
import { CrawlExecutionError, type CrawlExecutor } from "./executors/types.js";
import { getCrawlerRecipes, resolveRecipeSource, type CrawlSource } from "./recipes.js";
```

Add constructor options:

```ts
interface CrawlerServiceOptions {
  executors?: CrawlExecutor[];
}
```

Change the constructor signature:

```ts
  constructor(crawlers?: TenderCrawler[], options: CrawlerServiceOptions = {}) {
```

Add executor initialization inside the constructor:

```ts
    this.executors = options.executors ?? [
      new DirectFetchExecutor(),
      new RemoteBrowserExecutor()
    ];
```

Add private field:

```ts
  private executors: CrawlExecutor[] = [];
```

Add public recipe method:

```ts
  getRecipes() {
    return getCrawlerRecipes();
  }
```

- [ ] **Step 4: Add recipe crawl implementation**

Add this method to `CrawlerService`:

```ts
  async runRecipeCrawl(input: {
    siteKey: string;
    sourceKey: string;
    maxPages?: number;
  }): Promise<CrawlJob> {
    const { recipe, source, maxPages } = resolveRecipeSource({
      siteKey: input.siteKey,
      sourceKey: input.sourceKey,
      requestedMaxPages: input.maxPages
    });

    const job: CrawlJob = {
      id: `crawl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      siteName: recipe.siteName,
      siteKey: recipe.siteKey,
      sourceKey: source.key,
      status: "running",
      startedAt: new Date(),
      pagesTotal: maxPages,
      pagesCrawled: 0,
      tendersFound: 0,
      tendersNew: 0,
      strategyAttempts: []
    };
    this.jobs.unshift(job);

    try {
      const companyProfile = await this.getCompanyProfile();
      for (let page = 1; page <= maxPages; page++) {
        const collected = await this.collectWithFallback(source, page, job);
        job.pagesCrawled = page;

        const items = extractRecipeListItems(collected.html, source);
        for (const item of items) {
          job.tendersFound++;
          try {
            const detail = await this.collectDetailWithFallback(item.detailUrl, source, job);
            const tender = await this.buildTenderFromCollected(recipe.city, item, detail.html);
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
            job.strategyAttempts?.push({
              strategy: "remote_browser",
              status: "failed",
              url: item.detailUrl,
              errorCode: "DETAIL_FETCH_FAILED",
              message: String(err)
            });
          }
        }
      }
      job.status = "completed";
    } catch (err) {
      job.status = job.tendersFound > 0 ? "completed" : "failed";
      job.error = String(err);
    }

    job.completedAt = new Date();
    return job;
  }
```

Add helper methods and functions below `getCompanyProfile()`:

```ts
  private async collectWithFallback(source: CrawlSource, page: number, job: CrawlJob) {
    for (const strategy of source.strategies) {
      const executor = this.executors.find((candidate) => candidate.strategy === strategy);
      if (!executor) continue;
      try {
        const collected = await executor.collectList(source, page);
        job.strategyAttempts?.push(collected.attempt);
        return collected;
      } catch (err) {
        if (err instanceof CrawlExecutionError) {
          job.strategyAttempts?.push(err.attempt);
          continue;
        }
        job.strategyAttempts?.push({
          strategy,
          status: "failed",
          url: source.url,
          errorCode: "PARSER_FAILED",
          message: String(err)
        });
      }
    }
    throw new Error(`All crawl strategies failed for ${source.key}`);
  }

  private async collectDetailWithFallback(url: string, source: CrawlSource, job: CrawlJob) {
    for (const strategy of source.strategies) {
      const executor = this.executors.find((candidate) => candidate.strategy === strategy);
      if (!executor) continue;
      try {
        const collected = await executor.collectDetail(url);
        job.strategyAttempts?.push(collected.attempt);
        return collected;
      } catch (err) {
        if (err instanceof CrawlExecutionError) {
          job.strategyAttempts?.push(err.attempt);
        }
      }
    }
    throw new Error(`All detail strategies failed for ${url}`);
  }
```

Add these file-level helper functions near the bottom of `service.ts`:

```ts
function extractRecipeListItems(html: string, source: CrawlSource): TenderListItem[] {
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis;
  const items: TenderListItem[] = [];
  let match: RegExpExecArray | null;

  while ((match = anchorPattern.exec(html)) !== null) {
    const title = stripTags(match[2]).trim();
    if (!title) continue;
    const detailUrl = new URL(match[1], source.url).toString();
    items.push({
      sectionNo: detailUrl,
      projectName: title,
      sectionName: title,
      publishDate: "",
      detailUrl,
      sourceSite: source.name
    });
  }

  return items;
}

function stripTags(input: string): string {
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}
```

Add method:

```ts
  private async buildTenderFromCollected(
    city: string,
    item: TenderListItem,
    html: string
  ): Promise<TenderNotice> {
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const fields = extractTenderFields(text);
    return {
      city,
      url: item.detailUrl,
      title: item.projectName,
      contentText: text,
      sourceHtml: html,
      budgetAmount: fields.budgetAmount ?? item.budgetAmount,
      deadlineTime: fields.deadlineTime,
      qualificationRequirements: fields.qualificationRequirements,
      personnelRequirements: fields.personnelRequirements,
      performanceRequirements: fields.performanceRequirements
    };
  }
```

Add `extractTenderFields` import:

```ts
import { extractTenderFields } from "../tender/extract-tender-fields.js";
```

- [ ] **Step 5: Update crawler routes**

Modify `backend/src/routes/crawler.ts`:

```ts
crawlerRouter.get("/crawler/recipes", (_request, response) => {
  response.json(crawlerService.getRecipes());
});
```

Update `/crawler/run` body handling:

```ts
  const { siteName, siteKey, sourceKey, maxPages } = request.body ?? {};

  try {
    const job =
      siteKey && sourceKey
        ? await crawlerService.runRecipeCrawl({
            siteKey,
            sourceKey,
            maxPages: Math.min(maxPages ?? 3, 10)
          })
        : await crawlerService.runCrawl(
            siteName,
            Math.min(maxPages ?? 3, 10)
          );
    response.json(job);
  } catch (err) {
    response.status(400).json({ error: String(err) });
  }
```

- [ ] **Step 6: Run backend tests**

Run: `npm run test -w backend -- executor-fallback.test.ts recipes.test.ts`

Expected: PASS for recipe and fallback tests.

- [ ] **Step 7: Commit**

```bash
git add backend/src/crawler/service.ts backend/src/routes/crawler.ts backend/src/crawler/__tests__/executor-fallback.test.ts
git commit -m "feat: orchestrate recipe crawler fallback"
```

---

### Task 5: Frontend Crawl Center

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Add frontend types and state**

Modify `frontend/src/App.tsx` near the existing type declarations:

```ts
interface CrawlRecipe {
  siteKey: string;
  siteName: string;
  city: string;
  sources: {
    key: string;
    name: string;
    maxPages: number;
    strategies: string[];
  }[];
}

interface CrawlJob {
  id: string;
  siteName: string;
  siteKey?: string;
  sourceKey?: string;
  status: "running" | "completed" | "failed" | "skipped";
  startedAt: string;
  completedAt?: string;
  pagesTotal: number;
  pagesCrawled: number;
  tendersFound: number;
  tendersNew: number;
  error?: string;
  strategyAttempts?: {
    strategy: string;
    status: string;
    url: string;
    errorCode?: string;
    message?: string;
  }[];
}
```

Update mode type:

```ts
const [mode, setMode] = useState<"dashboard" | "admin" | "crawler">("dashboard");
```

Add state in `App()`:

```ts
const [recipes, setRecipes] = useState<CrawlRecipe[]>([]);
const [jobs, setJobs] = useState<CrawlJob[]>([]);
const [selectedSiteKey, setSelectedSiteKey] = useState("huaian");
const [selectedSourceKey, setSelectedSourceKey] = useState("construction");
const [crawlPages, setCrawlPages] = useState(1);
const [crawlLoading, setCrawlLoading] = useState(false);
```

- [ ] **Step 2: Add crawler API helpers**

Add functions inside `App()`:

```ts
async function fetchCrawlerData() {
  const [recipeResponse, jobResponse] = await Promise.all([
    fetch(`${API}/crawler/recipes`),
    fetch(`${API}/crawler/jobs`)
  ]);
  if (recipeResponse.ok) setRecipes(await recipeResponse.json());
  if (jobResponse.ok) setJobs(await jobResponse.json());
}

async function startRecipeCrawl() {
  setCrawlLoading(true);
  try {
    await fetch(`${API}/crawler/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteKey: selectedSiteKey,
        sourceKey: selectedSourceKey,
        maxPages: crawlPages
      })
    });
    await fetchCrawlerData();
    await fetchTenders();
  } finally {
    setCrawlLoading(false);
  }
}
```

Add effect:

```ts
useEffect(() => { if (mode === "crawler") fetchCrawlerData(); }, [mode]);
```

- [ ] **Step 3: Add navigation button**

In the topbar button group, add:

```tsx
<button className={`btn ${mode === "crawler" ? "btn-primary" : ""}`} onClick={() => setMode("crawler")}>采集中心</button>
```

- [ ] **Step 4: Add crawler view render branch**

Before the admin branch, add this render branch:

```tsx
) : mode === "crawler" ? (
  <section className="crawler-panel">
    <div className="panel">
      <div className="panel-header">
        <div>
          <p className="panel-eyebrow">Silent remote browser collection</p>
          <h2>采集中心</h2>
        </div>
        <button className="btn" onClick={fetchCrawlerData}>刷新状态</button>
      </div>
      <div className="crawler-controls">
        <label>
          <span>站点</span>
          <select value={selectedSiteKey} onChange={e => setSelectedSiteKey(e.target.value)}>
            {recipes.map(recipe => <option key={recipe.siteKey} value={recipe.siteKey}>{recipe.siteName}</option>)}
          </select>
        </label>
        <label>
          <span>分类</span>
          <select value={selectedSourceKey} onChange={e => setSelectedSourceKey(e.target.value)}>
            {(recipes.find(recipe => recipe.siteKey === selectedSiteKey)?.sources ?? []).map(source => (
              <option key={source.key} value={source.key}>{source.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>页数</span>
          <input type="number" min={1} max={10} value={crawlPages} onChange={e => setCrawlPages(Number(e.target.value) || 1)} />
        </label>
        <button className="btn btn-primary" disabled={crawlLoading} onClick={startRecipeCrawl}>
          {crawlLoading ? "采集中" : "开始采集"}
        </button>
      </div>
    </div>
    <div className="panel">
      <div className="panel-header">
        <div>
          <p className="panel-eyebrow">Crawler jobs</p>
          <h2>任务记录</h2>
        </div>
      </div>
      <div className="crawler-jobs">
        {jobs.map(job => (
          <div key={job.id} className="crawler-job">
            <div>
              <strong>{job.siteName}</strong>
              <span>{job.status} · {job.pagesCrawled}/{job.pagesTotal} pages · {job.tendersFound} found · {job.tendersNew} new</span>
              {job.error && <span className="crawler-error">{job.error}</span>}
            </div>
            <div className="crawler-attempts">
              {(job.strategyAttempts ?? []).slice(-3).map((attempt, index) => (
                <span key={`${job.id}-${index}`} className={`crawler-attempt crawler-attempt--${attempt.status}`}>
                  {attempt.strategy}: {attempt.status}{attempt.errorCode ? ` (${attempt.errorCode})` : ""}
                </span>
              ))}
            </div>
          </div>
        ))}
        {jobs.length === 0 && <div className="empty-state-full"><p>暂无采集任务</p></div>}
      </div>
    </div>
  </section>
```

- [ ] **Step 5: Add styles**

Append to `frontend/src/styles.css`:

```css
.crawler-panel {
  display: grid;
  gap: 18px;
}

.crawler-controls {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  align-items: end;
}

.crawler-controls label {
  display: grid;
  gap: 6px;
  color: var(--color-muted);
  font-size: 12px;
}

.crawler-controls select,
.crawler-controls input {
  height: 36px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 0 10px;
  background: #fff;
  color: var(--color-text);
}

.crawler-jobs {
  display: grid;
  gap: 10px;
}

.crawler-job {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: #fff;
}

.crawler-job strong,
.crawler-job span {
  display: block;
}

.crawler-error {
  color: #b42318;
  margin-top: 4px;
}

.crawler-attempts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.crawler-attempt {
  border-radius: 999px;
  padding: 3px 8px;
  font-size: 12px;
  background: #f5f5f5;
  color: var(--color-muted);
}

.crawler-attempt--succeeded {
  background: #e8f5e9;
  color: #237804;
}

.crawler-attempt--failed {
  background: #fff1f0;
  color: #a8071a;
}

@media (max-width: 900px) {
  .crawler-controls {
    grid-template-columns: 1fr;
  }

  .crawler-job {
    flex-direction: column;
  }
}
```

- [ ] **Step 6: Run frontend typecheck**

Run: `npm run typecheck -w frontend`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.tsx frontend/src/styles.css
git commit -m "feat: add crawl center UI"
```

---

### Task 6: Final Verification And Push

**Files:**
- Modify if needed: `README.md`

- [ ] **Step 1: Run backend tests**

Run: `npm run test -w backend`

Expected: PASS.

- [ ] **Step 2: Run full typecheck**

Run: `npm run typecheck`

Expected: PASS for backend and frontend.

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: PASS for backend and frontend.

- [ ] **Step 4: Document remote browser env vars if implementation introduced them**

If `README.md` does not list runtime environment variables, add this section:

```md
## Remote Browser Crawler

Remote browser collection is optional. Configure these variables on the backend server to enable Browserbase-compatible collection:

- `BROWSERBASE_API_KEY`
- `BROWSERBASE_PROJECT_ID`
- `REMOTE_BROWSER_TIMEOUT_MS`

If these variables are missing, direct fetch crawlers continue to work and remote browser jobs fail with a structured diagnostic.
```

- [ ] **Step 5: Commit verification docs**

If `README.md` changed:

```bash
git add README.md
git commit -m "docs: document remote browser crawler config"
```

If `README.md` did not change, record no commit for this step.

- [ ] **Step 6: Push**

Run: `git push origin main`

Expected: push succeeds and remote `main` contains the design, plan, and implementation commits.

---

## Self-Review Notes

- Spec coverage: the plan covers recipes, silent remote browser execution, backend-only credentials, fallback, frontend trigger/status, diagnostics, tests, and verification.
- Scope control: browser extension, local user-machine agent, manual browser control, CAPTCHA solving, and queue infrastructure remain outside this first implementation.
- Type consistency: strategy values are consistently `backend_fetch` and `remote_browser`; recipe keys are `siteKey` and `sourceKey`; job diagnostics use `strategyAttempts`.
