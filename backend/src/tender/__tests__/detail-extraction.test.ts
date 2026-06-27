import { describe, expect, it } from "vitest";
import {
  extractDeepTenderDetail,
  extractLinksFromHtml,
  htmlToText
} from "../detail-extraction.js";

describe("detail extraction", () => {
  it("extracts readable text from nested content blocks", () => {
    const text = htmlToText(
      '<div class="con"><p>Tender notice</p><script>bad()</script><p>Budget&nbsp;100</p></div>'
    );

    expect(text).toContain("Tender notice");
    expect(text).toContain("Budget 100");
    expect(text).not.toContain("bad()");
  });

  it("classifies iframe detail pages and tender document links", () => {
    const links = extractLinksFromHtml(
      `<div class="con">
        <iframe src="/detail/body.html"></iframe>
        <a href="/download/tender-file.pdf">Tender document download</a>
        <a href="https://other.example.com/file.docx">招标文件</a>
      </div>`,
      "https://example.com/root/index.html"
    );

    expect(links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: "https://example.com/detail/body.html",
          kind: "detail"
        }),
        expect.objectContaining({
          url: "https://example.com/download/tender-file.pdf",
          kind: "document"
        }),
        expect.objectContaining({
          url: "https://other.example.com/file.docx",
          kind: "document"
        })
      ])
    );
  });

  it("follows linked detail pages and returns document attachments", async () => {
    const fetched = new Map([
      [
        "https://example.com/detail/body.html",
        '<div class="con"><p>Real notice text from tab page</p></div>'
      ]
    ]);

    const result = await extractDeepTenderDetail({
      entryUrl: "https://example.com/root/index.html",
      initialHtml: `<html><body>
        <div class="con">
          <p>Landing shell</p>
          <iframe src="/detail/body.html"></iframe>
          <a href="/files/tender.txt">Tender document</a>
        </div>
      </body></html>`,
      fetchText: async (url) => {
        const html = fetched.get(url);
        if (!html) throw new Error(`Unexpected URL: ${url}`);
        return html;
      }
    });

    expect(result.contentText).toContain("Landing shell");
    expect(result.contentText).toContain("Real notice text from tab page");
    expect(result.attachments).toEqual([
      expect.objectContaining({
        url: "https://example.com/files/tender.txt",
        status: "linked"
      })
    ]);
  });
});
