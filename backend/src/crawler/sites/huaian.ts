import type { TenderNotice } from "../../domain/types.js";
import type {
  CrawlPageResult,
  TenderCrawler,
  TenderListItem
} from "../types.js";
import { CrawlerUnavailableError } from "../types.js";

/**
 * Crawler for 淮安市公共资源交易平台.
 *
 * The site `https://ggzy.huaian.gov.cn` is unreachable from this server
 * (TCP connection times out on both HTTP and HTTPS).  This is likely a
 * geo-IP restriction or firewall rule on the Huai'an side.  The crawler
 * is registered so the system knows it exists, but automated collection
 * requires either a relay server inside the allowed region or explicit
 * whitelisting of this server's IP.
 */
export class HuaianCrawler implements TenderCrawler {
  readonly siteName = "淮安市公共资源交易平台（网络不可达）";
  readonly city = "淮安";
  readonly offline = true;

  async fetchList(): Promise<CrawlPageResult> {
    throw new CrawlerUnavailableError({
      code: "NETWORK_RESTRICTED",
      message:
        "淮安市公共资源交易平台 (ggzy.huaian.gov.cn) 从当前服务器无法连接，可能受 IP 地域限制。",
      recommendedAction: "使用省内 IP 或 VPN 后重试"
    });
  }

  async fetchDetail(_item: TenderListItem): Promise<TenderNotice> {
    throw new CrawlerUnavailableError({
      code: "NETWORK_RESTRICTED",
      message: "淮安平台网络不可达，暂不支持详情采集。",
      recommendedAction: "使用省内 IP 或 VPN 后重试"
    });
  }
}
