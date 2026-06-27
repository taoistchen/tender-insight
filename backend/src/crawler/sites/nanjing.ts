import type { TenderNotice } from "../../domain/types.js";
import { extractDeepTenderDetail } from "../../tender/detail-extraction.js";
import { fetchTenderDocuments } from "../../tender/document-fetcher.js";
import { extractTenderFields } from "../../tender/extract-tender-fields.js";
import type {
  CrawlPageResult,
  TenderCrawler,
  TenderListItem
} from "../types.js";

const BASE_URL = "http://njggzy.nanjing.gov.cn";
const LIST_PATH = "/njweb/fjsz/068001/068001002";
const LIST_URL = `${BASE_URL}${LIST_PATH}/moreinfo.html`;
const PAGE_URL = (page: number) => `${BASE_URL}${LIST_PATH}/${page}.html`;

export class NanjingCrawler implements TenderCrawler {
  readonly siteName = "南京市公共资源交易平台";
  readonly city = "南京";

  async fetchList(page = 1): Promise<CrawlPageResult> {
    const html = await this.#fetchText(page === 1 ? LIST_URL : PAGE_URL(page));
    return this.#parseListHtml(html, page);
  }

  async fetchDetail(item: TenderListItem): Promise<TenderNotice> {
    const html = await this.#fetchText(item.detailUrl);
    const title = this.#extractMeta(html, "ArticleTitle") ?? item.projectName;
    const pubDate = this.#extractMeta(html, "PubDate") ?? item.publishDate;
    const detail = await extractDeepTenderDetail({
      entryUrl: item.detailUrl,
      initialHtml: html,
      fetchText: (url) => this.#fetchText(url)
    });
    const attachments = await fetchTenderDocuments(detail.attachments);
    const documentTexts = attachments
      .map((attachment) => attachment.textContent)
      .filter((text): text is string => Boolean(text));
    const extractionText = [detail.contentText, ...documentTexts].join("\n\n");
    const fields = extractTenderFields(extractionText);
    const deadlineStr =
      this.#extractDeadline(html) ?? this.#extractDeadline(extractionText);

    return {
      city: this.city,
      url: item.detailUrl,
      title,
      sourceHtml: detail.sourceHtml,
      resolvedLinks: detail.resolvedLinks,
      attachments,
      documentTexts,
      contentText: `${title}\nPublished: ${pubDate}\n${extractionText}`.slice(
        0,
        32_768
      ),
      budgetAmount: fields.budgetAmount ?? item.budgetAmount,
      deadlineTime: deadlineStr ? parseDate(deadlineStr) : fields.deadlineTime,
      qualificationRequirements: fields.qualificationRequirements,
      personnelRequirements: fields.personnelRequirements,
      performanceRequirements: fields.performanceRequirements
    };
  }

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
      return decodeBuffer(Buffer.from(await response.arrayBuffer()));
    } finally {
      clearTimeout(timeout);
    }
  }

  #parseListHtml(html: string, page: number): CrawlPageResult {
    const items: TenderListItem[] = [];
    const itemRegex =
      /<li\s+class="ewb-info-item2[^"]*"\s+onclick="window\.open\('([^']+)'\)[^"]*">([\s\S]*?)<\/li>/gi;

    let match;
    while ((match = itemRegex.exec(html)) !== null) {
      const detailPath = match[1];
      const itemHtml = match[2];
      const sectionNo = extractNthTitle(itemHtml, "ewb-info-top2", 1);
      const projectName = extractNthTitle(itemHtml, "ewb-info-top2", 2);
      const sectionName = extractNthTitle(itemHtml, "ewb-info-top2", 3);
      const budgetStr = extractNthTitle(itemHtml, "ewb-info-top2", 4);
      const publishDate = extractNthTitle(itemHtml, "ewb-info-top2", 5);
      if (!sectionNo || !projectName) continue;

      const budget =
        budgetStr && budgetStr !== "/"
          ? Number.parseFloat(budgetStr) * 10_000
          : undefined;

      items.push({
        sectionNo,
        projectName,
        sectionName,
        budgetAmount: Number.isNaN(budget) ? undefined : budget,
        publishDate,
        detailUrl: new URL(detailPath, BASE_URL).toString(),
        sourceSite: this.siteName
      });
    }

    const pageMatch = html.match(/<span[^>]*id="index\d+"[^>]*>\s*\d+\/(\d+)\s*<\/span>/i);
    const totalPages = pageMatch ? Number.parseInt(pageMatch[1], 10) : 1;
    return { items, totalPages, currentPage: page };
  }

  #extractMeta(html: string, name: string): string | null {
    const match = html.match(
      new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"`, "i")
    );
    return match ? match[1].trim() : null;
  }

  #extractDeadline(text: string): string | null {
    const match = text.match(
      /(?:投标|递交)(?:文件)?(?:截止|递交截止)时间\s*[:：]?\s*(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?\s*\d{1,2}[:：]\d{1,2})/
    );
    return match ? match[1] : null;
  }
}

function extractNthTitle(html: string, className: string, n: number): string {
  const regex = new RegExp(
    `<p[^>]*title="([^"]*)"[^>]*class="${className}"`,
    "gi"
  );
  let count = 0;
  let match;
  while ((match = regex.exec(html)) !== null) {
    count++;
    if (count === n) return match[1].trim();
  }
  return "";
}

function decodeBuffer(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("gbk", { fatal: false }).decode(buffer);
  }
}

function parseDate(raw: string): Date | undefined {
  const normalized = raw
    .replace(/年/g, "-")
    .replace(/月/g, "-")
    .replace(/日/g, "")
    .replace("：", ":")
    .trim();
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
