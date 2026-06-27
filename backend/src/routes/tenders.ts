import { Router } from "express";
import { crawlerService } from "../crawler/service.js";

export const tendersRouter = Router();

tendersRouter.get("/tenders", async (_request, response) => {
  const tenders = await crawlerService.getAllTenders();
  response.json(tenders);
});
