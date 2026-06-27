import { Router } from "express";
import { crawlerService } from "../crawler/service.js";

export const tendersRouter = Router();

tendersRouter.get("/tenders", (_request, response) => {
  const tenders = crawlerService.getAllTenders();
  response.json(tenders);
});
