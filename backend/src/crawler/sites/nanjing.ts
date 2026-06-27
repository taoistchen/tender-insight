import { extractTenderFields } from "../../tender/extract-tender-fields.js";
import type { TenderNotice } from "../../domain/types.js";
import type {
  CrawlPageResult,
  TenderCrawler,
  TenderListItem
} from "../types.js";

const BASE_URL = "http://njggzy.nanjing.gov.cn";
const LIST_PATH = "/njweb/fjsz/068001/068001002";
const LIST_URL = `${BASE_URL}${LIST_PATH}/moreinfo.html`;
const PAGE_URL = (page: number) =>
  `${BASE_URL}${LIST_PATH}/${page}.html`;

/**
 * Crawler for 南京市公共资源交易平台 — 房建市政 → 招标公告 → 工程类.
 *
 * The listing is server-rendered HTML (no JS needed for initial fetch).
 * Detail pages use embedded `geb-input-inline` spans for fill-in fields;
 * we extract the raw content text and delegate structured extraction to
 * the shared `extractTenderFields` module.
 */
export class NanjingCrawler implements TenderCrawler {
  readonly siteName = "南京市公共资源交易平台";
  readonly city = "南京";

  /* ─── List ─── */

  async fetchList(page = 1): Promise<CrawlPageResult> {
    const url = page === 1 ? LIST_URL : PAGE_URL(page);
    const html = await this.#fetchText(url);

    return this.#parseListHtml(html, page);
  }

  /* ─── Detail ─── */

  async fetchDetail(item: TenderListItem): Promise<TenderNotice> {
    const html = await this.#fetchText(item.detailUrl);

    const title = this.#extractMeta(html, "ArticleTitle") ?? item.projectName;
    const pubDate = this.#extractMeta(html, "PubDate") ?? item.publishDate;

    // Extract the main content block.
    // The "con" div contains deeply nested HTML (including a full embedded
    // document), so a simple regex can't match the correct closing </div>.
    // We find the start marker then walk forward tracking div depth.
    const conStart = html.indexOf('<div class="con"');
    let rawHtml = "";
    if (conStart >= 0) {
      let depth = 0;
      let i = conStart;
      while (i < html.length) {
        const slice = html.slice(i);
        const openMatch = slice.match(/<div[\s>]/i);
        const closeMatch = slice.match(/<\/div>/i);
        const openIdx = openMatch ? openMatch.index! : Infinity;
        const closeIdx = closeMatch ? closeMatch.index! : Infinity;

        if (openIdx < closeIdx) {
          depth++;
          i += openIdx + openMatch![0].length;
        } else if (closeIdx < Infinity) {
          depth--;
          i += closeIdx + 6; // length of "</div>"
          if (depth === 0) {
            rawHtml = html.slice(conStart, i);
            break;
          }
        } else {
          break;
        }
      }
    }

    // Strip HTML tags and decode entities for plain text extraction
    const contentText = this.#htmlToText(rawHtml);

    // Parse deadline from meta or content
    const deadlineStr =
      this.#extractDeadlineFromMeta(html) ??
      this.#extractDeadlineFromContent(contentText);

    const fields = extractTenderFields(contentText);

    return {
      city: this.city,
      url: item.detailUrl,
      title,
      contentText:
        `${title}\n发布时间：${pubDate}\n${contentText}`.slice(0, 16_384),
      budgetAmount: fields.budgetAmount ?? item.budgetAmount,
      deadlineTime: deadlineStr
        ? this.#parseChineseDate(deadlineStr)
        : fields.deadlineTime,
      qualificationRequirements: fields.qualificationRequirements,
      personnelRequirements: fields.personnelRequirements,
      performanceRequirements: fields.performanceRequirements
    };
  }

  /* ─── Private helpers ─── */

  async #fetchText(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }

      // The site uses GBK or GB2312 encoding — try to decode
      const buffer = Buffer.from(await response.arrayBuffer());
      return this.#decodeBuffer(buffer);
    } finally {
      clearTimeout(timeout);
    }
  }

  #decodeBuffer(buffer: Buffer): string {
    // Try UTF-8 first (newer pages), fall back to GBK
    try {
      const utf8 = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      return utf8;
    } catch {
      // GBK fallback
      const gbk = new TextDecoder("gbk", { fatal: false }).decode(buffer);
      return gbk;
    }
  }

  #parseListHtml(html: string, page: number): CrawlPageResult {
    const items: TenderListItem[] = [];

    // Each item is an <li> with class "ewb-info-item2" and an onclick
    const itemRegex =
      /<li\s+class="ewb-info-item2[^"]*"\s+onclick="window\.open\('([^']+)'\)[^"]*">([\s\S]*?)<\/li>/gi;

    let match;
    while ((match = itemRegex.exec(html)) !== null) {
      const detailPath = match[1];
      const itemHtml = match[2];

      const sectionNo = this.#extractTitle(itemHtml, "ewb-info-top2");
      const projectName = this.#extractNthTitle(itemHtml, "ewb-info-top2", 2);
      const sectionName = this.#extractNthTitle(itemHtml, "ewb-info-top2", 3);
      const budgetStr = this.#extractNthTitle(itemHtml, "ewb-info-top2", 4);
      const publishDate = this.#extractNthTitle(itemHtml, "ewb-info-top2", 5);

      if (!sectionNo || !projectName) continue;

      const budget =
        budgetStr && budgetStr !== "/"
          ? Number.parseFloat(budgetStr) * 10_000
          : undefined;

      items.push({
        sectionNo,
        projectName,
        sectionName: sectionName ?? "",
        budgetAmount: Number.isNaN(budget) ? undefined : budget,
        publishDate,
        detailUrl: `${BASE_URL}${detailPath}`,
        sourceSite: this.siteName
      });
    }

    // Extract total pages
    const pageMatch = html.match(/<span id="index\d+">1\/(\d+)<\/span>/);
    const totalPages = pageMatch ? Number.parseInt(pageMatch[1], 10) : 1;

    return { items, totalPages, currentPage: page };
  }

  #extractTitle(html: string, className: string): string {
    const match = html.match(
      new RegExp(`<p[^>]*title="([^"]*)"[^>]*class="${className}"`, "i")
    );
    return match ? match[1].trim() : "";
  }

  #extractNthTitle(
    html: string,
    className: string,
    n: number
  ): string {
    const regex = new RegExp(
      `<p[^>]*title="([^"]*)"[^>]*class="${className}"`,
      "gi"
    );
    let count = 0;
    let m;
    while ((m = regex.exec(html)) !== null) {
      count++;
      if (count === n) return m[1].trim();
    }
    return "";
  }

  #extractMeta(html: string, name: string): string | null {
    const match = html.match(
      new RegExp(
        `<meta\\s+name="${name}"\\s+content="([^"]*)"`,
        "i"
      )
    );
    return match ? match[1].trim() : null;
  }

  #extractDeadlineFromMeta(html: string): string | null {
    // Look for "投标截止时间" pattern in the content area
    const match = html.match(
      /投标截止时间[：:]\s*(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?\s*\d{1,2}[:：]\d{1,2})/
    );
    return match ? match[1] : null;
  }

  #extractDeadlineFromContent(text: string): string | null {
    const match = text.match(
      /投标截止时间[：:]\s*(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?\s*\d{1,2}[:：]\d{1,2})/
    );
    return match ? match[1] : null;
  }

  /**
   * Parse a Chinese date string to a Date object.
   * Handles: "2026年06月26日 15:56", "2026-06-26 15:56", "2026/06/26 15:56"
   */
  #parseChineseDate(raw: string): Date | undefined {
    // Normalize Chinese date separators
    let normalized = raw
      .replace(/年/g, "-")
      .replace(/月/g, "-")
      .replace(/日/g, "")
      .trim();

    // Ensure time separator is colon
    normalized = normalized.replace(/(\d{1,2})[时](\d{1,2})/, "$1:$2");

    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  #htmlToText(html: string): string {
    return (
      html
        // Remove scripts and styles
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        // Replace block elements with newlines
        .replace(/<\/(?:div|p|h\d|li|tr|br)[^>]*>/gi, "\n")
        .replace(/<br\s*\/?>/gi, "\n")
        // Remove remaining tags
        .replace(/<[^>]*>/g, "")
        // Decode common entities
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        // Collapse whitespace
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    );
  }
}
