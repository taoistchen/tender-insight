import { extractTenderFields } from "../../tender/extract-tender-fields.js";
import type { TenderNotice } from "../../domain/types.js";
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

/** Kimi vision model for captcha OCR. */
const KIMI_MODEL = "moonshot-v1-32k-vision-preview";

/** Kimi API key — provided by the operator. */
let kimiApiKey = "";

export function setKimiApiKey(key: string) {
  kimiApiKey = key;
}

/**
 * Crawler for 镇江市公共资源交易平台.
 *
 * The platform uses a captcha-protected full-text search API.  Captcha
 * images are solved via the Kimi multimodal model.  Once the search index
 * is populated the crawler is ready to use.
 */
export class ZhenjiangCrawler implements TenderCrawler {
  readonly siteName = "镇江市公共资源交易平台";
  readonly city = "镇江";

  /* ─── List ─── */

  async fetchList(page = 1): Promise<CrawlPageResult> {
    if (!kimiApiKey) {
      throw new Error("镇江采集器需要 Kimi API Key，请先调用 setKimiApiKey()");
    }

    const pageSize = 20;
    const pn = (page - 1) * pageSize;

    // Solve captcha
    const { imgguid, captcha } = await this.#solveCaptcha();

    // Verify
    const verifyOk = await this.#verifyCaptcha(imgguid, captcha);
    if (!verifyOk) {
      throw new Error("验证码验证失败，请重试");
    }

    // Search
    const params = {
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
          "镇江公共资源交易搜索接口可访问，但建设工程招标公告索引为空，无法返回公告列表。",
        recommendedAction: "联系平台方修复镇江公共资源交易搜索索引后重试"
      });
    }

    const items: TenderListItem[] = records.map((r) => ({
      sectionNo: r.infoid ?? "",
      projectName: r.title ?? "",
      sectionName: "",
      budgetAmount: undefined,
      publishDate: r.infodatepx?.substring(0, 10) ?? "",
      detailUrl: `${BASE_URL}/jyxx/001001/001001002/${r.infodatepx?.substring(0, 10)?.replace(/-/g, "")}/${r.infoid}.html`,
      sourceSite: this.siteName
    }));

    const totalPages = Math.ceil(total / pageSize) || 1;

    return { items, totalPages, currentPage: page };
  }

  /* ─── Detail ─── */

  async fetchDetail(item: TenderListItem): Promise<TenderNotice> {
    const html = await this.#fetchText(item.detailUrl);

    const title =
      this.#extractMeta(html, "ArticleTitle") ?? item.projectName;
    const pubDate =
      this.#extractMeta(html, "PubDate") ?? item.publishDate;

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

    return {
      city: this.city,
      url: item.detailUrl,
      title,
      contentText:
        `${title}\n发布时间：${pubDate}\n${contentText}`.slice(0, 16_384),
      budgetAmount: fields.budgetAmount ?? item.budgetAmount,
      deadlineTime: fields.deadlineTime,
      qualificationRequirements: fields.qualificationRequirements,
      personnelRequirements: fields.personnelRequirements,
      performanceRequirements: fields.performanceRequirements
    };
  }

  /* ─── Captcha ─── */

  async #solveCaptcha(): Promise<{ imgguid: string; captcha: string }> {
    // 1. Get captcha metadata
    const cr = await fetch(
      `${CAPTCHA_URL}?i=${Date.now()}&response=application/json`
    );
    const raw = await cr.text();
    const outer = JSON.parse(raw) as { return: string };
    const fixed = outer.return.replace(/\\/g, "/");
    const inner = JSON.parse(fixed) as { Value: string }[];
    const imgguid = inner[0].Value;
    const imgPath = inner[1].Value;

    // 2. Download captcha image
    const ir = await fetch(`${BASE_URL}${imgPath}`);
    const imgBuffer = Buffer.from(await ir.arrayBuffer());
    const base64 = imgBuffer.toString("base64");

    // 3. OCR via Kimi
    const kr = await fetch("https://api.moonshot.cn/v1/chat/completions", {
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
                  url: `data:image/jpeg;base64,${base64}`
                }
              },
              {
                type: "text",
                text: "识别图片中的4位验证码，只输出4个字符，不要任何解释。"
              }
            ]
          }
        ],
        max_tokens: 10
      })
    });

    if (!kr.ok) {
      throw new Error(`Kimi API returned HTTP ${kr.status}`);
    }

    const kj = (await kr.json()) as {
      choices: { message: { content: string } }[];
    };
    const captcha = kj.choices[0].message.content
      .trim()
      .replace(/[^a-zA-Z0-9]/g, "");

    return { imgguid, captcha };
  }

  async #verifyCaptcha(
    imgguid: string,
    captcha: string
  ): Promise<boolean> {
    const vr = await fetch(
      `${VERIFY_URL}?imgguid=${imgguid}&yzm=${captcha}&response=application/json`
    );
    const text = await vr.text();
    try {
      const vj = JSON.parse(text) as { return: number | string };
      return vj.return === 1 || vj.return === "1";
    } catch {
      return false;
    }
  }

  /* ─── Shared helpers ─── */

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

  #extractMeta(html: string, name: string): string | null {
    const match = html.match(
      new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"`, "i")
    );
    return match ? match[1].trim() : null;
  }

  #htmlToText(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<\/(?:div|p|h\d|li|tr|br)[^>]*>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
}

interface ZhenjiangRecord {
  title?: string;
  infoid?: string;
  infodatepx?: string;
  zhuanzai?: string;
}
