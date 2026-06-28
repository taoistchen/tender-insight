import { afterEach, describe, expect, it, vi } from "vitest";
import { LianyungangCrawler } from "../sites/lianyungang.js";

describe("crawler pagination", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests the requested Lianyungang list page and parses total pages", async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        requested.push(url);
        return {
          ok: true,
          arrayBuffer: async () =>
            Buffer.from(`
              <a href="/lygweb/jyxx/001001/001001001/20260628/abc.html" target="_blank" title="Tender A"></a>
              <span id="index1">2/7</span>
            `)
        };
      })
    );

    const result = await new LianyungangCrawler().fetchList(2);

    expect(requested[0]).toContain("/lygweb/jyxx/001001/001001001/2.html");
    expect(result.currentPage).toBe(2);
    expect(result.totalPages).toBe(7);
    expect(result.items[0].projectName).toBe("Tender A");
  });
});
