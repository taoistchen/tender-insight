import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CrawlerUnavailableError,
  type CrawlPageResult,
  type TenderCrawler,
  type TenderListItem
} from "../types.js";
import { CrawlerService } from "../service.js";
import { HuaianCrawler } from "../sites/huaian.js";
import { ZhenjiangCrawler } from "../sites/zhenjiang.js";
import type { TenderNotice } from "../../domain/types.js";

describe("external crawler availability", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks known external crawler failures as skipped jobs", async () => {
    const crawler: TenderCrawler = {
      siteName: "测试外部不可用平台",
      city: "测试",
      async fetchList(): Promise<CrawlPageResult> {
        throw new CrawlerUnavailableError({
          code: "NETWORK_RESTRICTED",
          message: "测试平台网络不可达",
          recommendedAction: "使用省内 IP 或 VPN 后重试"
        });
      },
      async fetchDetail(_item: TenderListItem): Promise<TenderNotice> {
        throw new Error("not reached");
      }
    };

    const service = new CrawlerService([crawler]);
    const job = await service.runCrawl(crawler.siteName, 1);

    expect(job.status).toBe("skipped");
    expect(job.errorCode).toBe("NETWORK_RESTRICTED");
    expect(job.error).toContain("测试平台网络不可达");
    expect(job.recommendedAction).toBe("使用省内 IP 或 VPN 后重试");
  });

  it("reports Huai'an as requiring provincial network access", async () => {
    const crawler = new HuaianCrawler();

    await expect(crawler.fetchList()).rejects.toMatchObject({
      code: "NETWORK_RESTRICTED",
      recommendedAction: "使用省内 IP 或 VPN 后重试"
    });
  });

  it("reports Zhenjiang empty search index as a platform-side issue", async () => {
    const crawler = new ZhenjiangCrawler();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.includes("/inteligentsearch/rest/inteligentSearch/getFullTextData")) {
        return new Response(
          JSON.stringify({
            result: {
              totalcount: 0,
              records: []
            }
          }),
          { status: 200 }
        );
      }

      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(crawler.fetchList(1)).rejects.toMatchObject({
      code: "SEARCH_INDEX_EMPTY",
      recommendedAction: "联系平台方修复镇江公共资源交易搜索索引后重试"
    });
  });
});
