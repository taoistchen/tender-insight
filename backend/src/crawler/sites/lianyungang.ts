import type { TenderNotice } from "../../domain/types.js";
import { extractDeepTenderDetail } from "../../tender/detail-extraction.js";
import { fetchTenderDocuments } from "../../tender/document-fetcher.js";
import { extractTenderFields } from "../../tender/extract-tender-fields.js";
import type {
  CrawlPageResult,
  TenderCrawler,
  TenderListItem
} from "../types.js";

const BASE_URL = "http://ggzy.lyg.gov.cn";
// 001001001 = 招标公告 in Lianyungang (different from Nanjing's 001001002)
const LIST_PATH = "/lygweb/jyxx/001001/001001001";
const LIST_URL = `${BASE_URL}${LIST_PATH}/tradeInfo.html`;
const PAGE_URL = (page: number) => `${BASE_URL}${LIST_PATH}/${page}.html`;

export class LianyungangCrawler implements TenderCrawler {
  readonly siteName = "连云港市公共资源交易平台";
  readonly city = "连云港";

  async fetchList(page = 1): Promise<CrawlPageResult> {
    const html = await this.#fetchText(page === 1 ? LIST_URL : PAGE_URL(page));
    return this.#parseListHtml(html, page);
  }

  async fetchDetail(item: TenderListItem): Promise<TenderNotice> {
    const html = await this.#fetchText(item.detailUrl);
    if (/流标|废标|终止公告|终止招标|招标失败|采购失败/.test(html.slice(0, 3000).replace(/<[^>]+>/g, " "))) {
      throw new Error(`Flow-bid page skipped: ${item.detailUrl}`);
    }
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
      sourceSite: item.sourceSite,
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
      publishDate: pubDate || undefined,
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
      /<a\s+href="(\/lygweb\/jyxx\/001001\/001001001\/\d+\/[a-z0-9-]+\.html)"\s+target="_blank"\s+title="([^"]*)"/gi;

    let match;
    while ((match = itemRegex.exec(html)) !== null) {
      items.push({
        sectionNo: "",
        projectName: match[2],
        sectionName: "",
        budgetAmount: undefined,
        publishDate: match[1].match(/\/(\d{8})\//)?.[1] ?? "",
        detailUrl: new URL(match[1], BASE_URL).toString(),
        sourceSite: this.siteName
      });
    }

    const pageMatch =
      html.match(/<span[^>]*id="index\d+"[^>]*>\s*\d+\/(\d+)\s*<\/span>/i) ??
      html.match(/共\s*(\d+)\s*页/i);
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
