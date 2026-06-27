# Remote Browser Crawler Design

## Goal

Add a production-friendly collection path for tender sites that cannot be reached reliably by backend `fetch`. The system should silently simulate human browser activity through a remote browser provider, collect tender list/detail data, and pass the results into the existing backend parsing, storage, and analysis pipeline.

The user experience must remain simple: users trigger a crawl and see job status/results. They must not need to operate, watch, or understand the remote browser.

## Scope

In scope:

- Configure multiple source URLs per city/site.
- Keep backend `fetch` as the first strategy where it works.
- Add a remote browser fallback strategy for blocked, JavaScript-heavy, or interaction-heavy sites.
- Run the remote browser headlessly or hidden from users.
- Simulate normal page actions such as open page, wait for render, click tabs, paginate, scroll, and read DOM/HTML.
- Route all extracted data through backend validation, deduplication, persistence, and tender analysis.
- Expose frontend controls for crawl trigger, strategy/status display, and job results.
- Record enough diagnostics for failures: failing URL, strategy, error code, message, and optional screenshot path.

Out of scope for the first version:

- Letting users manually control a browser session.
- Browser extension collection.
- Local user-machine crawler agent.
- CAPTCHA solving.
- Full AI-only parsing of every site.
- Large queue infrastructure unless current synchronous jobs become a bottleneck.

## Architecture

The frontend is a crawl control surface, not the crawler runtime.

The backend owns crawl orchestration, provider credentials, site recipes, fallback order, parsing, validation, deduplication, storage, and analysis. This keeps API keys out of the browser and avoids CORS limitations in ordinary frontend JavaScript.

Remote browser execution is isolated behind an executor interface so Browserbase, bb-browser, Playwright over CDP, or another compatible provider can be swapped without rewriting site parsing or the frontend.

```text
Frontend Crawl Center
  -> POST /api/crawler/run
Backend CrawlerService
  -> SiteRecipe lookup
  -> DirectFetchExecutor
  -> RemoteBrowserExecutor
  -> HTML/list/detail extraction
  -> Existing tender parsing
  -> Existing tender upsert + analysis
  -> GET /api/crawler/jobs
```

## Site Recipes

Crawler configuration should move toward explicit site recipes. A recipe describes where to collect data and which strategies are allowed.

Example shape:

```json
{
  "siteKey": "huaian",
  "siteName": "Huaian Public Resource Trading Platform",
  "city": "Huaian",
  "enabled": true,
  "sources": [
    {
      "key": "construction",
      "name": "Construction",
      "url": "https://ggzy.huaian.gov.cn/...",
      "maxPages": 5,
      "strategies": ["backend_fetch", "remote_browser"],
      "actions": [
        { "type": "goto", "urlFrom": "source.url" },
        { "type": "waitForSelector", "selector": ".list" },
        { "type": "extractHtml", "selector": "body" }
      ],
      "selectors": {
        "items": ".list li",
        "title": "a",
        "detailUrl": "a@href",
        "publishDate": ".date"
      }
    }
  ]
}
```

The first implementation can keep existing hardcoded city crawlers and add recipes only for the new remote-browser path. Over time, the site-specific crawlers can consume recipes where practical.

## Execution Flow

For each selected source:

1. Create a crawl job with selected site, source, max pages, and strategy order.
2. Try `backend_fetch` if enabled.
3. If direct fetch fails with network restriction, timeout, empty rendering, or known blocked response, mark that strategy as failed and continue.
4. Start `remote_browser`.
5. Open the configured URL in a remote browser session.
6. Run configured actions: wait, click, scroll, paginate, extract DOM/HTML.
7. Parse extracted list items into `TenderListItem`.
8. For each item, collect detail HTML through the best available strategy.
9. Reuse existing detail extraction, document discovery, field extraction, tender upsert, and analysis.
10. Store strategy attempts and diagnostics on the job.

The remote browser should be invisible to users. Live view is not part of the normal product flow.

## Remote Browser Executor

Add an executor boundary similar to:

```ts
interface CrawlExecutor {
  readonly strategy: "backend_fetch" | "remote_browser";
  collectList(source: CrawlSource, page: number): Promise<CollectedPage>;
  collectDetail(item: TenderListItem): Promise<CollectedPage>;
}
```

`RemoteBrowserExecutor` responsibilities:

- Create and close provider sessions safely.
- Navigate to source URLs.
- Execute bounded interaction steps.
- Enforce timeouts and page limits.
- Return HTML, final URL, title, optional screenshot, and structured extraction metadata.
- Never expose provider credentials to frontend code.

The executor should prefer deterministic selectors first. If a page is too dynamic for selectors, a later enhancement can add AI-assisted extraction as a separate step.

## Frontend Experience

Add a crawl center view or panel:

- Site selector.
- Source/category selector.
- Max pages input with backend cap.
- Strategy display: `backend fetch`, `remote browser`.
- Start crawl button.
- Job list with status, pages crawled, tenders found, new tenders, failed strategy, and error message.
- Refresh existing tender dashboard after a completed crawl.

The UI must not show a browser window. Screenshots are diagnostic artifacts only and can be exposed later in an admin/debug view.

## Error Handling

Use structured strategy attempts:

```json
{
  "strategy": "remote_browser",
  "status": "failed",
  "url": "https://...",
  "errorCode": "SELECTOR_NOT_FOUND",
  "message": "List container did not appear within timeout",
  "screenshotPath": "..."
}
```

Expected error categories:

- `NETWORK_RESTRICTED`
- `TIMEOUT`
- `SELECTOR_NOT_FOUND`
- `EMPTY_RESULT`
- `REMOTE_BROWSER_UNAVAILABLE`
- `DETAIL_FETCH_FAILED`
- `PARSER_FAILED`

A job should complete partially when some sources/pages succeed. Total failure should preserve enough diagnostics to adjust recipes.

## Security And Configuration

Remote browser credentials belong in backend environment variables, for example:

- `REMOTE_BROWSER_PROVIDER`
- `BROWSERBASE_API_KEY`
- `BROWSERBASE_PROJECT_ID`
- `REMOTE_BROWSER_TIMEOUT_MS`

Frontend code must never receive provider credentials.

The backend should cap pages per run, action count, and timeouts to prevent runaway jobs and provider cost surprises.

## Testing Strategy

Backend tests:

- Recipe validation accepts valid source config and rejects unsafe or incomplete actions.
- Strategy fallback moves from direct fetch to remote browser after known network failures.
- Remote browser executor can be tested with a mocked provider adapter.
- Job diagnostics record failed strategy attempts.
- Submitted/extracted HTML flows into existing tender parsing and upsert logic.

Frontend tests can remain light initially:

- Crawl panel renders site/source choices.
- Start crawl posts the selected settings.
- Job status renders success, partial success, and failure states.

Manual verification:

- Run existing backend typecheck/tests.
- Run one direct-fetch site to confirm no regression.
- Run one remote-browser configured source against a real target or local fixture page.

## Acceptance Criteria

- Users can start a crawl from the frontend without handling a browser session.
- Backend direct fetch still works for existing sites.
- A configured source can fall back to remote browser after direct fetch fails.
- Extracted tenders are stored and analyzed through the existing pipeline.
- Jobs expose clear status and diagnostics.
- Provider secrets remain backend-only.
