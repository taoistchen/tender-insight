import { extractTenderFields } from "../../tender/extract-tender-fields.js";
import type { TenderNotice } from "../../domain/types.js";
import type {
  CrawlPageResult,
  TenderCrawler,
  TenderListItem
} from "../types.js";

const BASE_URL = "http://ggzy.lyg.gov.cn";
const LIST_PATH = "/lygweb/jyxx/001001/001001002";
const LIST_URL = `${BASE_URL}${LIST_PATH}/tradeInfo.html`;

/**
 * Crawler for 连云港市公共资源交易平台 — 建设工程 → 招标公告.
 *
 * Page structure mirrors the Nanjing platform:
 * server-rendered HTML listing, detail pages with meta tags and
 * `<div class="con">` content blocks.
 */
export class LianyungangCrawler implements TenderCrawler {
  readonly siteName = "连云港市公共资源交易平台";
  readonly city = "连云港";

  async fetchList(_page?: number): Promise<CrawlPageResult> {
    const html = await this.#fetchText(LIST_URL);
    return this.#parseListHtml(html);
  }

  async fetchDetail(item: TenderListItem): Promise<TenderNotice> {
    const html = await this.#fetchText(item.detailUrl);

    const title = this.#extractMeta(html, "ArticleTitle") ?? item.projectName;
    const pubDate = this.#extractMeta(html, "PubDate") ?? item.publishDate;

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
          i += closeIdx + 6;
          if (depth === 0) {
            rawHtml = html.slice(conStart, i);
            break;
          }
        } else {
          break;
        }
      }
    }

    const contentText = this.#htmlToText(rawHtml);
    const fields = extractTenderFields(contentText);

    const deadlineStr =
      this.#extractDeadlineFromHtml(html) ??
      this.#extractDeadlineFromText(contentText);

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

  /* ─── Private ─── */

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
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      } catch {
        return new TextDecoder("gbk", { fatal: false }).decode(buffer);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  #parseListHtml(html: string): CrawlPageResult {
    const items: TenderListItem[] = [];

    const itemRegex =
      /<a\s+href="(\/lygweb\/jyxx\/001001\/001001002\/\d+\/[a-f0-9-]+\.html)"\s+target="_blank"\s+title="([^"]*)"/gi;

    let match;
    while ((match = itemRegex.exec(html)) !== null) {
      items.push({
        sectionNo: "",
        projectName: match[2],
        sectionName: "",
        budgetAmount: undefined,
        publishDate: match[1].match(/\/(\d{8})\//)?.[1] ?? "",
        detailUrl: `${BASE_URL}${match[1]}`,
        sourceSite: this.siteName
      });
    }

    return { items, totalPages: 1, currentPage: 1 };
  }

  #extractMeta(html: string, name: string): string | null {
    const match = html.match(
      new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"`, "i")
    );
    return match ? match[1].trim() : null;
  }

  #extractDeadlineFromHtml(html: string): string | null {
    const match = html.match(
      /投标(?:文件)?递交截止时间\s*[:：]\s*(\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}[:：]\d{1,2})/
    );
    return match ? match[1] : null;
  }

  #extractDeadlineFromText(text: string): string | null {
    const match = text.match(
      /投标(?:文件)?递交?截止时间[：:]\s*(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?\s*\d{1,2}[:：]\d{1,2})/
    );
    return match ? match[1] : null;
  }

  #parseChineseDate(raw: string): Date | undefined {
    let normalized = raw
      .replace(/年/g, "-").replace(/月/g, "-").replace(/日/g, "").trim();
    normalized = normalized.replace(/(\d{1,2})[时](\d{1,2})/, "$1:$2");
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  #htmlToText(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<\/(?:div|p|h\d|li|tr|br)[^>]*>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
}
