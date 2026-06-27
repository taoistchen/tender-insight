import { pool } from "./pool.js";
import type { TenderAnalysisResult } from "../domain/types.js";
import type { EnrichedTender } from "../crawler/service.js";

interface TenderRow {
  url: string;
  city: string;
  title: string;
  content_text: string | null;
  budget_amount: string | null;
  deadline_time: string | null;
  decision: string;
  match_score: number;
  matched_points: unknown;
  risk_points: unknown;
  manual_review_required: boolean;
}

interface QualRow { url: string; name: string; level: string; }
interface ReqRow { url: string; requirement: string; }

export async function upsertTender(
  tender: EnrichedTender
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Upsert tender notice
    const tenderResult = await client.query(
      `INSERT INTO tender_notice
         (url, city, title, source_site, content_text,
          budget_amount, deadline_time, publish_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (url) DO UPDATE SET
         title = EXCLUDED.title,
         content_text = EXCLUDED.content_text,
         budget_amount = EXCLUDED.budget_amount,
         deadline_time = EXCLUDED.deadline_time
       RETURNING id`,
      [
        tender.url,
        tender.city,
        tender.title,
        tender.city, // source_site — use city as label for now
        tender.contentText ?? "",
        tender.budgetAmount ?? null,
        tender.deadlineTime ?? null,
        null // publish_date
      ]
    );

    const tenderId = tenderResult.rows[0].id as number;

    // Clear and re-insert qualifications
    await client.query(
      "DELETE FROM tender_qualification WHERE tender_id = $1",
      [tenderId]
    );
    for (const q of tender.qualificationRequirements) {
      await client.query(
        "INSERT INTO tender_qualification (tender_id, name, level) VALUES ($1,$2,$3)",
        [tenderId, q.name, q.level]
      );
    }

    // Clear and re-insert personnel requirements
    await client.query(
      "DELETE FROM tender_personnel WHERE tender_id = $1",
      [tenderId]
    );
    for (const p of tender.personnelRequirements ?? []) {
      await client.query(
        "INSERT INTO tender_personnel (tender_id, requirement) VALUES ($1,$2)",
        [tenderId, p]
      );
    }

    // Clear and re-insert performance requirements
    await client.query(
      "DELETE FROM tender_performance WHERE tender_id = $1",
      [tenderId]
    );
    for (const p of tender.performanceRequirements ?? []) {
      await client.query(
        "INSERT INTO tender_performance (tender_id, requirement) VALUES ($1,$2)",
        [tenderId, p]
      );
    }

    // Upsert analysis
    const analysis = tender.analysis;
    await client.query(
      `INSERT INTO tender_analysis
         (tender_id, decision, match_score, matched_points,
          risk_points, manual_review_required)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tender_id) DO UPDATE SET
         decision = EXCLUDED.decision,
         match_score = EXCLUDED.match_score,
         matched_points = EXCLUDED.matched_points,
         risk_points = EXCLUDED.risk_points,
         manual_review_required = EXCLUDED.manual_review_required`,
      [
        tenderId,
        analysis.decision,
        analysis.matchScore,
        JSON.stringify(analysis.matchedPoints),
        JSON.stringify(analysis.riskPoints),
        analysis.manualReviewRequired
      ]
    );

    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("upsertTender error:", err);
    return false;
  } finally {
    client.release();
  }
}

export async function getAllTenders(): Promise<EnrichedTender[]> {
  const result = await pool.query(
    `SELECT
       tn.url, tn.city, tn.title, tn.content_text,
       tn.budget_amount, tn.deadline_time,
       ta.decision, ta.match_score,
       ta.matched_points, ta.risk_points,
       ta.manual_review_required
     FROM tender_notice tn
     JOIN tender_analysis ta ON ta.tender_id = tn.id
     ORDER BY tn.deadline_time DESC NULLS LAST`
  );

  const rows = result.rows as TenderRow[];
  return rows.map((row) => {
    const qualifications: { name: string; level: string }[] = [];
    const personnel: string[] = [];
    const performance: string[] = [];

    return {
      url: row.url,
      city: row.city,
      title: row.title,
      contentText: row.content_text ?? "",
      budgetAmount: row.budget_amount
        ? Number(row.budget_amount)
        : undefined,
      deadlineTime: row.deadline_time
        ? new Date(row.deadline_time)
        : undefined,
      qualificationRequirements: qualifications,
      personnelRequirements: personnel,
      performanceRequirements: performance,
      analysis: {
        decision: row.decision,
        matchScore: row.match_score,
        matchedPoints: (row.matched_points as string[]) ?? [],
        riskPoints: (row.risk_points as string[]) ?? [],
        manualReviewRequired: row.manual_review_required
      } as TenderAnalysisResult
    };
  });
}

/**
 * Load requirements (qual/personnel/performance) for a single tender.
 * We batch these to avoid N+1 queries in getAllTenders.
 */
export async function loadRequirements(
  tenders: EnrichedTender[]
): Promise<void> {
  const urls = tenders.map((t) => t.url);
  if (urls.length === 0) return;

  // Qualification
  const qualResult = await pool.query(
    `SELECT tn.url, tq.name, tq.level
     FROM tender_qualification tq
     JOIN tender_notice tn ON tn.id = tq.tender_id
     WHERE tn.url = ANY($1)`,
    [urls]
  );
  const qualMap = new Map<string, { name: string; level: string }[]>();
  for (const row of qualResult.rows as QualRow[]) {
    const list = qualMap.get(row.url) ?? [];
    list.push({ name: row.name, level: row.level });
    qualMap.set(row.url, list);
  }

  // Personnel
  const persResult = await pool.query(
    `SELECT tn.url, tp.requirement
     FROM tender_personnel tp
     JOIN tender_notice tn ON tn.id = tp.tender_id
     WHERE tn.url = ANY($1)`,
    [urls]
  );
  const persMap = new Map<string, string[]>();
  for (const row of persResult.rows as ReqRow[]) {
    const list = persMap.get(row.url) ?? [];
    list.push(row.requirement);
    persMap.set(row.url, list);
  }

  // Performance
  const perfResult = await pool.query(
    `SELECT tn.url, tp.requirement
     FROM tender_performance tp
     JOIN tender_notice tn ON tn.id = tp.tender_id
     WHERE tn.url = ANY($1)`,
    [urls]
  );
  const perfMap = new Map<string, string[]>();
  for (const row of perfResult.rows as ReqRow[]) {
    const list = perfMap.get(row.url) ?? [];
    list.push(row.requirement);
    perfMap.set(row.url, list);
  }

  for (const t of tenders) {
    t.qualificationRequirements = qualMap.get(t.url) ?? [];
    t.personnelRequirements = persMap.get(t.url) ?? [];
    t.performanceRequirements = perfMap.get(t.url) ?? [];
  }
}

export async function getTenderCount(): Promise<number> {
  const result = await pool.query("SELECT COUNT(*)::int AS cnt FROM tender_notice");
  return result.rows[0].cnt as number;
}
