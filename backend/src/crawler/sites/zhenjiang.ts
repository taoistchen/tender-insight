import type { TenderNotice } from "../../domain/types.js";
import type {
  CrawlPageResult,
  TenderCrawler,
  TenderListItem
} from "../types.js";

/**
 * Crawler for 镇江市公共资源交易平台.
 *
 * The platform uses a captcha-protected search API
 * (`/inteligentsearch/rest/inteligentSearch/getFullTextData`)
 * that requires a visual captcha token from `/services/zjggzynew/checkyzm`.
 *
 * Without captcha solving infrastructure (external service or headless
 * browser with OCR), automated scraping is not possible.  This crawler
 * surfaces that limitation cleanly rather than silently failing.
 */
export class ZhenjiangCrawler implements TenderCrawler {
  readonly siteName = "镇江市公共资源交易平台（需验证码）";
  readonly city = "镇江";
  readonly offline = true;

  async fetchList(): Promise<CrawlPageResult> {
    throw new Error(
      "镇江市公共资源交易平台需要图形验证码，暂不支持自动采集。" +
      "后续可通过接入 Playwright + OCR 验证码识别服务实现。"
    );
  }

  async fetchDetail(_item: TenderListItem): Promise<TenderNotice> {
    throw new Error("镇江平台需要验证码，暂不支持");
  }
}
