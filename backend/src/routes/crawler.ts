import { Router } from "express";
import { crawlerService } from "../crawler/service.js";

export const crawlerRouter = Router();

type CrawlerRunRequestValidation =
  | {
      ok: true;
      siteName?: string;
      siteKey?: string;
      sourceKey?: string;
      maxPages: number;
    }
  | {
      ok: false;
      error: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeMaxPages(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 3;
  }

  return Math.min(Math.max(1, Math.floor(value)), 10);
}

export function validateCrawlerRunRequest(
  body: unknown
): CrawlerRunRequestValidation {
  const input = isRecord(body) ? body : {};
  const siteName = optionalString(input["siteName"]);
  const siteKey = optionalString(input["siteKey"]);
  const sourceKey = optionalString(input["sourceKey"]);

  if (Boolean(siteKey) !== Boolean(sourceKey)) {
    return {
      ok: false,
      error: "siteKey and sourceKey must be provided together for recipe crawls"
    };
  }

  return {
    ok: true,
    siteName,
    siteKey,
    sourceKey,
    maxPages: normalizeMaxPages(input["maxPages"])
  };
}

crawlerRouter.get("/crawler/sites", (_request, response) => {
  response.json(crawlerService.getCrawlers());
});

crawlerRouter.get("/crawler/recipes", (_request, response) => {
  response.json(crawlerService.getRecipes());
});

crawlerRouter.get("/crawler/jobs", (_request, response) => {
  response.json(crawlerService.getJobs());
});

crawlerRouter.post("/crawler/run", async (request, response) => {
  const validation = validateCrawlerRunRequest(request.body);

  if (!validation.ok) {
    response.status(400).json({ error: validation.error });
    return;
  }

  try {
    const job =
      validation.siteKey && validation.sourceKey
        ? await crawlerService.runRecipeCrawl({
            siteKey: validation.siteKey,
            sourceKey: validation.sourceKey,
            maxPages: validation.maxPages
          })
        : await crawlerService.runCrawl(
            validation.siteName,
            validation.maxPages // cap at 10 pages per manual trigger
          );
    response.json(job);
  } catch (err) {
    response.status(400).json({ error: String(err) });
  }
});
