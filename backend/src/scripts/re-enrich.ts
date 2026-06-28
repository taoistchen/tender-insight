/**
 * One-shot script: re-enrich existing tenders by fetching their pages
 * and running DeepSeek AI extraction to fill in missing fields.
 *
 * Usage: AI_API_KEY=sk-xxx node dist/scripts/re-enrich.js
 */

import { pool } from "../db/pool.js";
import { extractTenderFromPage } from "../analysis/ai-extract.js";

async function main() {
  const client = await pool.connect();

  try {
    // Find tenders missing key data
    const { rows } = await client.query(
      `SELECT id, url FROM tender_notice
       WHERE (publish_date IS NULL OR budget_amount IS NULL)
       ORDER BY id`
    );

    console.log(`Found ${rows.length} tenders to re-enrich`);

    let updated = 0;
    let failed = 0;

    for (const row of rows) {
      const { id, url } = row as { id: number; url: string };

      try {
        console.log(`[${updated + failed + 1}/${rows.length}] Fetching ${url.slice(0, 80)}...`);

        // Fetch the page
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);

        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
              "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
          }
        });
        clearTimeout(timer);

        if (!response.ok) {
          console.warn(`  HTTP ${response.status} — skipped`);
          failed++;
          continue;
        }

        const html = await response.text();
        if (html.length < 500) {
          console.warn(`  Page too short (${html.length} bytes) — skipped`);
          failed++;
          continue;
        }

        // Run AI extraction
        const fields = await extractTenderFromPage(html);
        if (!fields) {
          console.warn(`  AI extraction returned null — skipped`);
          failed++;
          continue;
        }

        // Build UPDATE query
        const updates: string[] = [];
        const values: unknown[] = [];
        let paramIdx = 1;

        if (fields.budgetAmount && fields.budgetAmount > 0) {
          updates.push(`budget_amount = $${paramIdx++}`);
          values.push(fields.budgetAmount);
        }
        if (fields.publishDate) {
          updates.push(`publish_date = $${paramIdx++}`);
          values.push(fields.publishDate);
        }
        if (fields.deadlineTime) {
          const d = new Date(fields.deadlineTime);
          if (!Number.isNaN(d.getTime())) {
            updates.push(`deadline_time = $${paramIdx++}`);
            values.push(d.toISOString());
          }
        }

        if (updates.length === 0) {
          console.warn(`  No fields to update — skipped`);
          failed++;
          continue;
        }

        updates.push(`source_html = $${paramIdx++}`);
        values.push(html);

        values.push(id);
        await client.query(
          `UPDATE tender_notice SET ${updates.join(", ")} WHERE id = $${paramIdx}`,
          values
        );

        // Update qualifications
        if (fields.qualificationRequirements.length > 0) {
          await client.query(
            "DELETE FROM tender_qualification WHERE tender_id = $1",
            [id]
          );
          for (const q of fields.qualificationRequirements) {
            await client.query(
              "INSERT INTO tender_qualification (tender_id, name, level) VALUES ($1,$2,$3)",
              [id, q.name, q.level]
            );
          }
        }

        // Update personnel requirements
        if (fields.personnelRequirements.length > 0) {
          await client.query(
            "DELETE FROM tender_personnel WHERE tender_id = $1",
            [id]
          );
          for (const p of fields.personnelRequirements) {
            await client.query(
              "INSERT INTO tender_personnel (tender_id, requirement) VALUES ($1,$2)",
              [id, p]
            );
          }
        }

        // Update performance requirements
        if (fields.performanceRequirements.length > 0) {
          await client.query(
            "DELETE FROM tender_performance WHERE tender_id = $1",
            [id]
          );
          for (const p of fields.performanceRequirements) {
            await client.query(
              "INSERT INTO tender_performance (tender_id, requirement) VALUES ($1,$2)",
              [id, p]
            );
          }
        }

        console.log(
          `  ✅ budget=${fields.budgetAmount ?? "-"} pub=${fields.publishDate ?? "-"} quals=${fields.qualificationRequirements.length} pers=${fields.personnelRequirements.length} perf=${fields.performanceRequirements.length}`
        );
        updated++;
      } catch (err) {
        console.warn(`  ❌ ${String(err)}`);
        failed++;
      }
    }

    console.log(`\nDone: ${updated} updated, ${failed} failed, ${rows.length} total`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
