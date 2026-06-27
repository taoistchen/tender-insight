import { pool } from "./pool.js";
import type { TenderAnalysisResult } from "../domain/types.js";
import type { EnrichedTender } from "../crawler/service.js";

interface TenderRow {
  url: string;
  city: string;
  title: string;
  content_text: string | null;
  source_html: string | null;
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
interface DocRow {
  url: string;
  document_url: string;
  label: string | null;
  source_page_url: string | null;
  content_type: string | null;
  status: string;
  text_content: string | null;
  error: string | null;
}

export async function upsertTender(
  tender: EnrichedTender
): Promise<{ saved: boolean; isNew: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Upsert tender notice.  xmax=0 means the row was freshly inserted;
    // xmax!=0 means it was an existing row that was updated.
    const tenderResult = await client.query(
      `INSERT INTO tender_notice
         (url, city, title, source_site, content_text,
          source_html, budget_amount, deadline_time, publish_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (url) DO UPDATE SET
         title = EXCLUDED.title,
         content_text = EXCLUDED.content_text,
         source_html = EXCLUDED.source_html,
         budget_amount = EXCLUDED.budget_amount,
         deadline_time = EXCLUDED.deadline_time
       RETURNING id, (xmax = 0) AS is_new`,
      [
        tender.url,
        tender.city,
        tender.title,
        tender.city,
        tender.contentText ?? "",
        tender.sourceHtml ?? null,
        tender.budgetAmount ?? null,
        tender.deadlineTime ?? null,
        null
      ]
    );

    const row = tenderResult.rows[0] as { id: number; is_new: boolean };
    const tenderId = row.id;
    const isNew = row.is_new;

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

    await client.query("DELETE FROM tender_document WHERE tender_id = $1", [
      tenderId
    ]);
    for (const attachment of tender.attachments ?? []) {
      await client.query(
        `INSERT INTO tender_document
           (tender_id, url, label, source_page_url, content_type,
            status, text_content, error)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (tender_id, url) DO UPDATE SET
           label = EXCLUDED.label,
           source_page_url = EXCLUDED.source_page_url,
           content_type = EXCLUDED.content_type,
           status = EXCLUDED.status,
           text_content = EXCLUDED.text_content,
           error = EXCLUDED.error`,
        [
          tenderId,
          attachment.url,
          attachment.label,
          attachment.sourcePageUrl,
          attachment.contentType ?? null,
          attachment.status,
          attachment.textContent ?? null,
          attachment.error ?? null
        ]
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
    return { saved: true, isNew };
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("upsertTender error:", err);
    return { saved: false, isNew: false };
  } finally {
    client.release();
  }
}

export async function getAllTenders(): Promise<EnrichedTender[]> {
  const result = await pool.query(
    `SELECT
       tn.url, tn.city, tn.title, tn.content_text,
       tn.source_html,
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
      sourceHtml: row.source_html ?? undefined,
      budgetAmount: row.budget_amount
        ? Number(row.budget_amount)
        : undefined,
      deadlineTime: row.deadline_time
        ? new Date(row.deadline_time)
        : undefined,
      qualificationRequirements: qualifications,
      personnelRequirements: personnel,
      performanceRequirements: performance,
      attachments: [],
      documentTexts: [],
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

  const docResult = await pool.query(
    `SELECT tn.url,
            td.url AS document_url,
            td.label,
            td.source_page_url,
            td.content_type,
            td.status,
            td.text_content,
            td.error
     FROM tender_document td
     JOIN tender_notice tn ON tn.id = td.tender_id
     WHERE tn.url = ANY($1)`,
    [urls]
  );
  const docMap = new Map<string, DocRow[]>();
  for (const row of docResult.rows as DocRow[]) {
    const list = docMap.get(row.url) ?? [];
    list.push(row);
    docMap.set(row.url, list);
  }

  for (const t of tenders) {
    const docs = docMap.get(t.url) ?? [];
    t.attachments = docs.map((doc) => ({
      url: doc.document_url,
      label: doc.label ?? "",
      sourcePageUrl: doc.source_page_url ?? t.url,
      contentType: doc.content_type ?? undefined,
      status: doc.status as never,
      textContent: doc.text_content ?? undefined,
      error: doc.error ?? undefined
    }));
    t.documentTexts = t.attachments
      .map((attachment) => attachment.textContent)
      .filter((text): text is string => Boolean(text));
  }
}

export async function getTenderCount(): Promise<number> {
  const result = await pool.query("SELECT COUNT(*)::int AS cnt FROM tender_notice");
  return result.rows[0].cnt as number;
}
