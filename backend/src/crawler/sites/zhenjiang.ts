import type { TenderNotice } from "../../domain/types.js";
import { extractDeepTenderDetail } from "../../tender/detail-extraction.js";
import { fetchTenderDocuments } from "../../tender/document-fetcher.js";
import { extractTenderFields } from "../../tender/extract-tender-fields.js";
import type {
  CrawlPageResult,
  TenderCrawler,
  TenderListItem
} from "../types.js";
import { CrawlerUnavailableError } from "../types.js";

const BASE_URL = "http://ggzy.zhenjiang.gov.cn";
const SEARCH_URL = `${BASE_URL}/inteligentsearch/rest/inteligentSearch/getFullTextData`;
const DETAIL_PATH_URL = `${BASE_URL}/services/zjggzynew/getDetailPath`;

/**
 * Category number for 招标公告 (tender notice / 工程建设).
 * Matches all sub-categories via right-like prefix.
 */
const TENDER_CATEGORY_PRIMARY = "001001002";

const PAGE_SIZE = 20;

export class ZhenjiangCrawler implements TenderCrawler {
  readonly siteName = "镇江市公共资源交易平台";
  readonly city = "镇江";

  async fetchList(page = 1): Promise<CrawlPageResult> {
    const pn = (page - 1) * PAGE_SIZE;

    // Match the web page's param object structure exactly.
    // condition uses the "招标公告" (tender notice) category.
    const params = {
      token: "",
      pn,
      rn: `${PAGE_SIZE}`,
      sdt: "",
      edt: "",
      wd: "",
      inc_wd: "",
      exc_wd: "",
      fields: "title",
      cnum: "001",
      sort: '{"infodatepx":"0"}',
      ssort: "title",
      cl: 200,
      terminal: "",
      condition: JSON.stringify([
        {
          fieldName: "categorynum",
          isLike: true,
          likeType: 2, // right-like (prefix match)
          equal: TENDER_CATEGORY_PRIMARY
        }
      ]),
      time: null,
      highlights: "title",
      statistics: null,
      unionCondition: null,
      accuracy: "",
      noParticiple: "1",
      searchRange: null,
      isBusiness: "1"
    };

    const response = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=utf-8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Referer: `${BASE_URL}/jyxx/tradeInfonew.html?type=gcjs`
      },
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      throw new Error(`Search API returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      result?: { totalcount: number; records: ZhenjiangRecord[] };
    };
    const records = data.result?.records ?? [];
    const total = data.result?.totalcount ?? 0;

    if (total === 0 && records.length === 0) {
      throw new CrawlerUnavailableError({
        code: "SEARCH_INDEX_EMPTY",
        message:
          "Zhenjiang search API is reachable, but tender notice search index is empty.",
        recommendedAction: "联系平台方修复镇江公共资源交易搜索索引后重试"
      });
    }

    const items: TenderListItem[] = records.map((record) => {
      // infoid is an array in the API response, take the first element
      const infoid = Array.isArray(record.infoid)
        ? record.infoid[0]
        : (record.infoid ?? "");
      const publishDate = record.infodatepx?.substring(0, 10) ?? "";
      return {
        sectionNo: infoid,
        projectName: record.title ?? "",
        sectionName: "",
        budgetAmount: undefined,
        publishDate,
        // Detail URL resolved lazily in fetchDetail via getDetailPath API
        detailUrl: "",
        sourceSite: this.siteName
      };
    });

    return {
      items,
      totalPages: Math.ceil(total / PAGE_SIZE) || 1,
      currentPage: page
    };
  }

  async fetchDetail(item: TenderListItem): Promise<TenderNotice> {
    // Resolve the actual detail page URL via the platform's API
    const detailUrl = item.sectionNo
      ? await this.#resolveDetailUrl(item.sectionNo)
      : item.detailUrl;

    if (!detailUrl) {
      throw new Error(
        `Cannot resolve detail URL for infoid: ${item.sectionNo}`
      );
    }

    const html = await this.#fetchText(detailUrl);
    const title = this.#extractMeta(html, "ArticleTitle") ?? item.projectName;
    const pubDate = this.#extractMeta(html, "PubDate") ?? item.publishDate;
    const detail = await extractDeepTenderDetail({
      entryUrl: detailUrl,
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
      url: detailUrl,
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

  /** Resolve the detail page path for a given infoId via the platform API. */
  async #resolveDetailUrl(infoId: string): Promise<string | null> {
    try {
      const response = await fetch(
        `${DETAIL_PATH_URL}?infoId=${encodeURIComponent(infoId)}&response=application/json`
      );
      if (!response.ok) return null;
      const data = (await response.json()) as { return?: string };
      if (data.return) {
        return `${BASE_URL}${data.return}`;
      }
      return null;
    } catch {
      return null;
    }
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

interface ZhenjiangRecord {
  title?: string;
  infoid?: string | string[];
  infodatepx?: string;
  zhuanzai?: string;
}
