import { Router } from "express";

export const healthRouter = Router();

healthRouter.get("/health", (_request, response) => {
  response.json({
    status: "ok",
    service: "tender-insight",
    timestamp: new Date().toISOString()
  });
});
