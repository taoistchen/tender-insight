/**
 * Browser-side crawler that uses a Service Worker to fetch pages
 * from the user's browser IP, bypassing server-side geo-restrictions.
 *
 * On page load, it automatically crawls restricted-site recipes
 * and sends fetched HTML to the backend for parsing and storage.
 */

const API = "/api";
const SW_SCOPE = "/";

interface PendingRequest {
  resolve: (value: SwFetchResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface SwFetchResult {
  ok: boolean;
  status: number;
  finalUrl: string;
  body: string;
  error?: string;
}

interface CrawlRecipe {
  siteKey: string;
  siteName: string;
  city: string;
  sources: {
    key: string;
    name: string;
    url: string;
    maxPages: number;
    strategies: string[];
  }[];
}

interface IngestResult {
  ok: boolean;
  detailUrls?: string[];
  processed?: number;
  error?: string;
}

let nextRequestId = 1;
const pending = new Map<number, PendingRequest>();
let swReady = false;

/* ---- Service Worker registration ---- */

async function registerSw(): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    console.warn("Service Worker not supported, browser crawl disabled");
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register(
      `${SW_SCOPE}sw.js`,
      { scope: SW_SCOPE }
    );
    await navigator.serviceWorker.ready;
    console.log("Browser crawl SW ready:", registration.scope);

    navigator.serviceWorker.addEventListener("message", (event) => {
      const data = event.data as {
        requestId: number;
        ok: boolean;
        status: number;
        finalUrl?: string;
        body?: string;
        error?: string;
      };
      if (!data || data.requestId === undefined) return;

      const pendingReq = pending.get(data.requestId);
      if (!pendingReq) return;

      clearTimeout(pendingReq.timer);
      pending.delete(data.requestId);

      if (data.ok) {
        pendingReq.resolve({
          ok: true,
          status: data.status,
          finalUrl: data.finalUrl ?? "",
          body: data.body ?? ""
        });
      } else {
        pendingReq.resolve({
          ok: false,
          status: data.status,
          finalUrl: "",
          body: "",
          error: data.error ?? "Unknown fetch error"
        });
      }
    });

    swReady = true;
  } catch (err) {
    // Self-signed cert → SW not available. Browser crawl will use manual paste fallback.
    console.info("SW unavailable (expected with self-signed cert). Use manual paste for restricted sites.");
  }
}

/* ---- Fetch via Service Worker ---- */

function fetchViaBrowser(url: string, timeoutMs = 30000): Promise<SwFetchResult> {
  return new Promise((resolve, reject) => {
    if (!swReady || !navigator.serviceWorker.controller) {
      reject(new Error("Service Worker not available"));
      return;
    }

    const requestId = nextRequestId++;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`Fetch timeout for ${url}`));
    }, timeoutMs);

    pending.set(requestId, { resolve, reject, timer });

    navigator.serviceWorker.controller.postMessage({
      type: "FETCH",
      url,
      requestId
    });
  });
}

/* ---- Ingest: send fetched HTML to backend ---- */

async function ingestToBackend(
  siteKey: string,
  sourceKey: string,
  phase: "list" | "detail",
  pages: { url: string; html: string }[]
): Promise<IngestResult> {
  const response = await fetch(`${API}/crawler/browser-ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ siteKey, sourceKey, phase, pages })
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    return { ok: false, error: errorText || `HTTP ${response.status}` };
  }
  return (await response.json()) as IngestResult;
}

/* ---- Auto-crawl on page load ---- */

async function autoCrawl(recipes: CrawlRecipe[]): Promise<void> {
  if (!swReady) {
    console.log("Browser crawl: SW not ready, skipping auto-crawl");
    return;
  }

  for (const recipe of recipes) {
    for (const source of recipe.sources) {
      console.log(
        `Browser crawl: trying ${recipe.siteName}/${source.name} at ${source.url}...`
      );

      try {
        // Phase 1: Fetch list page from recipe's URL
        const baseUrl = source.url;
        const listResult = await fetchViaBrowser(baseUrl);
        if (!listResult.ok) {
          console.warn(
            `Browser crawl: list page failed for ${baseUrl}: HTTP ${listResult.status}`
          );
          continue;
        }

        console.log(
          `Browser crawl: list page fetched (${listResult.body.length} bytes)`
        );

        // Send list HTML to backend for parsing
        const listIngest = await ingestToBackend(
          recipe.siteKey,
          source.key,
          "list",
          [{ url: listResult.finalUrl, html: listResult.body }]
        );

        if (!listIngest.ok || !listIngest.detailUrls?.length) {
          console.log(
            `Browser crawl: no detail URLs found in list page for ${recipe.siteKey}`
          );
          continue;
        }

        console.log(
          `Browser crawl: ${listIngest.detailUrls.length} detail URLs found`
        );

        // Phase 2: Fetch detail pages
        const detailPages: { url: string; html: string }[] = [];
        for (const detailUrl of listIngest.detailUrls) {
          try {
            const detailResult = await fetchViaBrowser(detailUrl);
            if (detailResult.ok) {
              detailPages.push({
                url: detailResult.finalUrl,
                html: detailResult.body
              });
            }
          } catch (err) {
            console.warn(`Browser crawl: detail fetch failed for ${detailUrl}`);
          }
        }

        if (detailPages.length > 0) {
          const detailIngest = await ingestToBackend(
            recipe.siteKey,
            source.key,
            "detail",
            detailPages
          );
          console.log(
            `Browser crawl: ${detailIngest.processed ?? 0} tenders processed for ${recipe.siteName}`
          );
        }
      } catch (err) {
        console.error(`Browser crawl error for ${recipe.siteKey}:`, err);
      }
    }
  }
}

/* ---- Recipe URL resolution ---- */

function getSourceUrl(siteKey: string, sourceKey: string): string {
  const urls: Record<string, Record<string, string>> = {
    huaian: {
      construction: "https://ggzy.huaian.gov.cn/"
    }
  };

  const site = urls[siteKey];
  if (!site) {
    throw new Error(`Unknown site key: ${siteKey}`);
  }
  const url = site[sourceKey];
  if (!url) {
    throw new Error(`Unknown source: ${siteKey}/${sourceKey}`);
  }
  return url;
}

/* ---- Public API ---- */

export { registerSw, autoCrawl, fetchViaBrowser, type CrawlRecipe };
