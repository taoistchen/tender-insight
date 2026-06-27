import { describe, expect, it } from "vitest";
import { fetchTenderDocument } from "../document-fetcher.js";
import type { TenderAttachment } from "../../domain/types.js";

const baseAttachment: TenderAttachment = {
  url: "https://example.com/files/tender.html",
  label: "Tender document",
  sourcePageUrl: "https://example.com/detail.html",
  status: "linked"
};

describe("document fetcher", () => {
  it("downloads and extracts text from HTML tender documents", async () => {
    const result = await fetchTenderDocument(baseAttachment, async () => ({
      url: baseAttachment.url,
      contentType: "text/html; charset=utf-8",
      buffer: Buffer.from("<html><body><p>Qualification: Class 2</p></body></html>")
    }));

    expect(result.status).toBe("parsed");
    expect(result.textContent).toContain("Qualification: Class 2");
  });

  it("keeps unsupported binary documents visible for follow-up", async () => {
    const result = await fetchTenderDocument(
      { ...baseAttachment, url: "https://example.com/files/tender.zip" },
      async () => ({
        url: "https://example.com/files/tender.zip",
        contentType: "application/zip",
        buffer: Buffer.from([1, 2, 3])
      })
    );

    expect(result.status).toBe("unsupported");
    expect(result.error).toContain("Unsupported");
  });

  it("records failed downloads without dropping the attachment", async () => {
    const result = await fetchTenderDocument(baseAttachment, async () => {
      throw new Error("network timeout");
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("network timeout");
  });
});
