import { Router } from "express";
import { getTendersPaginated, getAllTenders } from "../db/tender-repo.js";
import { pool } from "../db/pool.js";

export const tendersRouter = Router();

tendersRouter.get("/tenders/stats", async (_request, response) => {
  try {
    const now = new Date().toISOString();
    const stats = await pool.query(`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE tn.deadline_time IS NULL OR tn.deadline_time >= $1)::int as active,
        COUNT(*) FILTER (WHERE (tn.deadline_time IS NULL OR tn.deadline_time >= $1) AND ta.decision = 'recommended')::int as recommended,
        COUNT(*) FILTER (WHERE (tn.deadline_time IS NULL OR tn.deadline_time >= $1) AND ta.decision = 'watch')::int as watch,
        COUNT(*) FILTER (WHERE (tn.deadline_time IS NULL OR tn.deadline_time >= $1) AND ta.decision = 'manual_review')::int as manual_review,
        COUNT(*) FILTER (WHERE (tn.deadline_time IS NULL OR tn.deadline_time >= $1) AND ta.decision = 'rejected')::int as rejected,
        COUNT(*) FILTER (WHERE (tn.deadline_time IS NULL OR tn.deadline_time >= $1) AND tn.deadline_time >= $1 AND tn.deadline_time <= $2)::int as expiring_soon
      FROM tender_notice tn
      JOIN tender_analysis ta ON ta.tender_id = tn.id
    `, [now, new Date(Date.now() + 7 * 86_400_000).toISOString()]);

    const r = stats.rows[0];
    response.json({
      total: r.total,
      active: r.active,
      recommended: r.recommended,
      watch: r.watch,
      manualReview: r.manual_review,
      rejected: r.rejected,
      expiringSoon: r.expiring_soon
    });
  } catch (err) {
    response.status(500).json({ error: String(err) });
  }
});

tendersRouter.get("/tenders", async (request, response) => {
  try {
    const page = Math.max(1, Number(request.query["page"]) || 1);
    const limit = Math.min(100, Math.max(1, Number(request.query["limit"]) || 10));
    const includeExpired = request.query["includeExpired"] === "1";

    const result = await getTendersPaginated(page, limit, includeExpired);

    response.json({
      items: result.items,
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / limit)
    });
  } catch (err) {
    response.status(500).json({ error: String(err) });
  }
});
