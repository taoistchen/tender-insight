/**
 * Backfill missing extracted fields on already-stored tenders.
 *
 * Re-runs enrichTenderWithAI on tenders missing budget / qualification /
 * personnel / performance, and writes back ONLY the fields that are currently
 * empty — existing populated fields are never overwritten, so AI extraction
 * nondeterminism can't regress good data.
 *
 * Root cause being remediated: the reasoning model returned empty/truncated
 * content under the old 2048-token budget, so AI returned null and the regex
 * fallback filled partial data. Fixed in ai/config.ts (retry on length) and
 * ai-extract.ts (4096 budget). This script backfills the historical casualties.
 *
 * Usage:
 *   node dist/scripts/reextract-missing.js            # fill-only on incomplete tenders
 *   node dist/scripts/reextract-missing.js --missing-deadline  # deadline-only pass
 */
import { pool } from "../db/pool.js";
import { enrichTenderWithAI } from "../tender/extract-tender-fields.js";
import type { TenderNotice } from "../domain/types.js";

interface TenderRow {
  id: number;
  url: string;
  city: string;
  title: string;
  source_site: string | null;
  content_text: string | null;
  source_html: string | null;
  has_budget: boolean;
  has_quals: boolean;
  has_persons: boolean;
  has_perfs: boolean;
}

async function main(): Promise<void> {
  const deadlineOnly = process.argv.includes("--missing-deadline");

  const where = deadlineOnly
    ? "WHERE deadline_time IS NULL"
    : `WHERE budget_amount IS NULL
         OR NOT EXISTS (SELECT 1 FROM tender_qualification q WHERE q.tender_id = tn.id)
         OR NOT EXISTS (SELECT 1 FROM tender_personnel p WHERE p.tender_id = tn.id)
         OR NOT EXISTS (SELECT 1 FROM tender_performance pf WHERE pf.tender_id = tn.id)`;

  const { rows } = await pool.query<TenderRow>(
    `SELECT tn.id, tn.url, tn.city, tn.title, tn.source_site,
            tn.content_text, tn.source_html,
            tn.budget_amount IS NOT NULL AS has_budget,
            EXISTS (SELECT 1 FROM tender_qualification q WHERE q.tender_id = tn.id) AS has_quals,
            EXISTS (SELECT 1 FROM tender_personnel p WHERE p.tender_id = tn.id) AS has_persons,
            EXISTS (SELECT 1 FROM tender_performance pf WHERE pf.tender_id = tn.id) AS has_perfs
       FROM tender_notice tn
       ${where}
       ORDER BY tn.id`
  );

  console.log(`Re-extracting ${rows.length} tender(s) [fill-only]...`);
  let filled = 0;
  for (const row of rows) {
    const tender: TenderNotice = {
      city: row.city,
      sourceSite: row.source_site ?? "",
      title: row.title,
      url: row.url,
      contentText: row.content_text ?? "",
      sourceHtml: row.source_html ?? undefined,
      qualificationRequirements: [],
      personnelRequirements: [],
      performanceRequirements: []
    };

    try {
      await enrichTenderWithAI(tender);
    } catch (err) {
      console.warn(`  id=${row.id} enrich failed: ${String(err)}`);
      continue;
    }

    // Build fill-only updates: never touch fields the row already has.
    const sets: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    if (!row.has_budget && tender.budgetAmount != null) {
      sets.push(`budget_amount = $${p++}`);
      params.push(tender.budgetAmount);
    }
    if (deadlineOnly && !tender.deadlineTime) {
      // deadline-only pass: still null after enrich — nothing to write
    }
    if (deadlineOnly && tender.deadlineTime) {
      sets.push(`deadline_time = $${p++}`);
      params.push(tender.deadlineTime);
    }

    let wrote = false;
    await pool.query("BEGIN");
    try {
      if (sets.length > 0) {
        params.push(row.id);
        await pool.query(
          `UPDATE tender_notice SET ${sets.join(", ")} WHERE id = $${p}`,
          params
        );
        wrote = true;
      }
      // Fill-only related tables: only when currently empty.
      if (!row.has_quals && tender.qualificationRequirements.length > 0) {
        for (const q of tender.qualificationRequirements) {
          await pool.query(
            "INSERT INTO tender_qualification (tender_id, name, level) VALUES ($1,$2,$3)",
            [row.id, q.name, q.level]
          );
        }
        wrote = true;
      }
      if (!row.has_persons && (tender.personnelRequirements?.length ?? 0) > 0) {
        for (const pr of tender.personnelRequirements!) {
          await pool.query(
            "INSERT INTO tender_personnel (tender_id, requirement) VALUES ($1,$2)",
            [row.id, pr]
          );
        }
        wrote = true;
      }
      if (!row.has_perfs && (tender.performanceRequirements?.length ?? 0) > 0) {
        for (const pf of tender.performanceRequirements!) {
          await pool.query(
            "INSERT INTO tender_performance (tender_id, requirement) VALUES ($1,$2)",
            [row.id, pf]
          );
        }
        wrote = true;
      }
      await pool.query("COMMIT");
      if (wrote) filled++;
      console.log(
        `  id=${row.id} ${wrote ? "filled" : "still empty"} | budget=${tender.budgetAmount ?? "-"} quals=${tender.qualificationRequirements.length} persons=${tender.personnelRequirements?.length ?? 0} perfs=${tender.performanceRequirements?.length ?? 0}`
      );
    } catch (err) {
      await pool.query("ROLLBACK");
      console.warn(`  id=${row.id} write failed: ${String(err)}`);
    }
  }

  console.log(`Done. ${filled}/${rows.length} had at least one field filled.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
