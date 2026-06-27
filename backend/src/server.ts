import fs from "node:fs";
import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { companyRouter } from "./routes/company.js";
import { crawlerRouter } from "./routes/crawler.js";
import { healthRouter } from "./routes/health.js";
import { tendersRouter } from "./routes/tenders.js";
import { crawlerService } from "./crawler/service.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use("/api", healthRouter);
app.use("/api", companyRouter);
app.use("/api", crawlerRouter);
app.use("/api", tendersRouter);

if (fs.existsSync(config.PUBLIC_DIR)) {
  app.use(express.static(config.PUBLIC_DIR));
  app.get("*", (_request, response) => {
    response.sendFile("index.html", { root: config.PUBLIC_DIR });
  });
}

async function start() {
  // Initialize database schema and load persisted data
  await crawlerService.init();

  app.listen(config.PORT, config.HOST, () => {
    console.log(
      `Tender Insight backend listening on http://${config.HOST}:${config.PORT}`
    );
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
