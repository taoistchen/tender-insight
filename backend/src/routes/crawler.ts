import { Router } from "express";
import { crawlerService } from "../crawler/service.js";

export const crawlerRouter = Router();

crawlerRouter.get("/crawler/sites", (_request, response) => {
  response.json(crawlerService.getCrawlers());
});

crawlerRouter.get("/crawler/jobs", (_request, response) => {
  response.json(crawlerService.getJobs());
});

crawlerRouter.post("/crawler/run", async (request, response) => {
  const { siteName, maxPages } = request.body ?? {};

  try {
    const job = await crawlerService.runCrawl(
      siteName,
      Math.min(maxPages ?? 3, 10) // cap at 10 pages per manual trigger
    );
    response.json(job);
  } catch (err) {
    response.status(400).json({ error: String(err) });
  }
});
