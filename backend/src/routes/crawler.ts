import { Router } from "express";
import { crawlerService } from "../crawler/service.js";

export const crawlerRouter = Router();

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
  const { siteName, siteKey, sourceKey, maxPages } = request.body ?? {};
  const cappedMaxPages = Math.min(maxPages ?? 3, 10);

  try {
    const job =
      siteKey && sourceKey
        ? await crawlerService.runRecipeCrawl({
            siteKey,
            sourceKey,
            maxPages: cappedMaxPages
          })
        : await crawlerService.runCrawl(
            siteName,
            cappedMaxPages // cap at 10 pages per manual trigger
          );
    response.json(job);
  } catch (err) {
    response.status(400).json({ error: String(err) });
  }
});
