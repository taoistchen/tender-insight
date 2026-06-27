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
const CAPTCHA_URL = `${BASE_URL}/services/FrontAppActionForWS/getYZM`;
const VERIFY_URL = `${BASE_URL}/services/zjggzynew/checkyzm`;
const CATEGORY_TENDER_NOTICE = "001001002";
const KIMI_MODEL = "moonshot-v1-32k-vision-preview";

let kimiApiKey = "";

export function setKimiApiKey(key: string) {
  kimiApiKey = key;
}

export class ZhenjiangCrawler implements TenderCrawler {
  readonly siteName = "镇江市公共资源交易平台";
  readonly city = "镇江";

  async fetchList(page = 1): Promise<CrawlPageResult> {
    if (!kimiApiKey) {
      throw new Error("Zhenjiang crawler requires KIMI_API_KEY");
    }

    const pageSize = 20;
    const pn = (page - 1) * pageSize;
    const { imgguid, captcha } = await this.#solveCaptcha();
    const verifyOk = await this.#verifyCaptcha(imgguid, captcha);
    if (!verifyOk) throw new Error("Zhenjiang captcha verification failed");

    const response = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=utf-8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Referer: `${BASE_URL}/jyxx/tradeInfonew.html?type=gcjs`
      },
      body: JSON.stringify({
        condition: [
          {
            fieldName: "categorynum",
            isLike: true,
            likeType: 2,
            equal: CATEGORY_TENDER_NOTICE
          }
        ],
        unionCondition: null,
        time: null,
        wd: null,
        pn,
        rn: pageSize
      })
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
      const publishDate = record.infodatepx?.substring(0, 10) ?? "";
      return {
        sectionNo: record.infoid ?? "",
        projectName: record.title ?? "",
        sectionName: "",
        budgetAmount: undefined,
        publishDate,
        detailUrl: `${BASE_URL}/jyxx/001001/001001002/${publishDate.replace(
          /-/g,
          ""
        )}/${record.infoid}.html`,
        sourceSite: this.siteName
      };
    });

    return {
      items,
      totalPages: Math.ceil(total / pageSize) || 1,
      currentPage: page
    };
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
      deadlineTime: fields.deadlineTime,
      qualificationRequirements: fields.qualificationRequirements,
      personnelRequirements: fields.personnelRequirements,
      performanceRequirements: fields.performanceRequirements
    };
  }

  async #solveCaptcha(): Promise<{ imgguid: string; captcha: string }> {
    const metadataResponse = await fetch(
      `${CAPTCHA_URL}?i=${Date.now()}&response=application/json`
    );
    const outer = JSON.parse(await metadataResponse.text()) as { return: string };
    const inner = JSON.parse(outer.return.replace(/\\/g, "/")) as {
      Value: string;
    }[];
    const imgguid = inner[0].Value;
    const imgPath = inner[1].Value;

    const imageResponse = await fetch(`${BASE_URL}${imgPath}`);
    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    const kimiResponse = await fetch("https://api.moonshot.cn/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${kimiApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: KIMI_MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${imageBuffer.toString("base64")}`
                }
              },
              {
                type: "text",
                text: "Recognize the 4-character captcha. Return only the captcha."
              }
            ]
          }
        ],
        max_tokens: 10
      })
    });

    if (!kimiResponse.ok) {
      throw new Error(`Kimi API returned HTTP ${kimiResponse.status}`);
    }

    const kimiJson = (await kimiResponse.json()) as {
      choices: { message: { content: string } }[];
    };
    return {
      imgguid,
      captcha: kimiJson.choices[0].message.content
        .trim()
        .replace(/[^a-zA-Z0-9]/g, "")
    };
  }

  async #verifyCaptcha(imgguid: string, captcha: string): Promise<boolean> {
    const response = await fetch(
      `${VERIFY_URL}?imgguid=${imgguid}&yzm=${captcha}&response=application/json`
    );
    try {
      const data = JSON.parse(await response.text()) as { return: number | string };
      return data.return === 1 || data.return === "1";
    } catch {
      return false;
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
}

function decodeBuffer(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("gbk", { fatal: false }).decode(buffer);
  }
}

interface ZhenjiangRecord {
  title?: string;
  infoid?: string;
  infodatepx?: string;
  zhuanzai?: string;
}
