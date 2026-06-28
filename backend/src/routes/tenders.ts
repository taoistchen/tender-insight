import { Router } from "express";
import { crawlerService } from "../crawler/service.js";

export const tendersRouter = Router();

tendersRouter.get("/tenders/stats", async (_request, response) => {
  try {
    const all = await crawlerService.getAllTenders();
    const now = new Date();
    const active = all.filter(
      (t) => !t.deadlineTime || new Date(t.deadlineTime).getTime() >= now.getTime()
    );
    const decisions = active.map((t) => t.analysis.decision);

    response.json({
      total: all.length,
      active: active.length,
      recommended: decisions.filter((d) => d === "recommended").length,
      watch: decisions.filter((d) => d === "watch").length,
      manualReview: decisions.filter((d) => d === "manual_review").length,
      rejected: decisions.filter((d) => d === "rejected").length,
      expiringSoon: active.filter((t) => {
        if (!t.deadlineTime) return false;
        const days = Math.ceil((new Date(t.deadlineTime).getTime() - now.getTime()) / 86_400_000);
        return days >= 0 && days <= 7;
      }).length
    });
  } catch (err) {
    response.status(500).json({ error: String(err) });
  }
});

tendersRouter.get("/tenders", async (request, response) => {
  try {
    const all = await crawlerService.getAllTenders();

    // Mark expired tenders (deadline has passed)
    const now = new Date();
    const enriched = all.map((t) => ({
      ...t,
      isExpired: t.deadlineTime ? new Date(t.deadlineTime).getTime() < now.getTime() : false
    }));

    // Exclude expired by default, unless ?includeExpired=1
    const includeExpired = request.query["includeExpired"] === "1";
    const active = includeExpired ? enriched : enriched.filter((t) => !t.isExpired);

    // Pagination
    const page = Math.max(1, Number(request.query["page"]) || 1);
    const limit = Math.min(100, Math.max(1, Number(request.query["limit"]) || 20));
    const total = active.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const items = active.slice(offset, offset + limit);

    response.json({
      items,
      page,
      limit,
      total,
      totalPages
    });
  } catch (err) {
    response.status(500).json({ error: String(err) });
  }
});
