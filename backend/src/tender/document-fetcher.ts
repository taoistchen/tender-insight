import { createRequire } from "node:module";
import type { TenderAttachment } from "../domain/types.js";
import { htmlToText } from "./detail-extraction.js";

const require = createRequire(import.meta.url);

export interface FetchedDocument {
  url: string;
  contentType?: string;
  buffer: Buffer;
}

export type DocumentFetcher = (url: string) => Promise<FetchedDocument>;

export async function fetchTenderDocument(
  attachment: TenderAttachment,
  fetcher: DocumentFetcher = defaultFetchDocument
): Promise<TenderAttachment> {
  try {
    const fetched = await fetcher(attachment.url);
    const contentType = fetched.contentType ?? inferContentType(fetched.url);
    const text = await extractDocumentText(fetched.buffer, contentType);

    if (text === null) {
      return {
        ...attachment,
        contentType,
        status: "unsupported",
        error: `Unsupported tender document type: ${contentType || "unknown"}`
      };
    }

    return {
      ...attachment,
      contentType,
      status: "parsed",
      textContent: text
    };
  } catch (err) {
    return {
      ...attachment,
      status: "failed",
      error: String(err)
    };
  }
}

export async function fetchTenderDocuments(
  attachments: TenderAttachment[],
  fetcher?: DocumentFetcher
): Promise<TenderAttachment[]> {
  const results: TenderAttachment[] = [];
  for (const attachment of attachments) {
    results.push(await fetchTenderDocument(attachment, fetcher));
  }
  return results;
}

async function defaultFetchDocument(url: string): Promise<FetchedDocument> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Accept: "*/*"
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return {
      url,
      contentType: response.headers.get("content-type") ?? undefined,
      buffer: Buffer.from(await response.arrayBuffer())
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function extractDocumentText(
  buffer: Buffer,
  contentType?: string
): Promise<string | null> {
  const lowerType = (contentType ?? "").toLowerCase();

  if (
    lowerType.includes("text/html") ||
    lowerType.includes("application/xhtml")
  ) {
    return htmlToText(decodeText(buffer));
  }

  if (lowerType.startsWith("text/") || lowerType.includes("json")) {
    return decodeText(buffer).trim();
  }

  if (lowerType.includes("pdf")) {
    return parsePdf(buffer);
  }

  if (
    lowerType.includes("wordprocessingml.document") ||
    lowerType.includes("msword") ||
    lowerType.includes("application/vnd.openxmlformats-officedocument")
  ) {
    return parseWord(buffer);
  }

  // Fallback: detect file type from magic bytes when content-type is unknown
  return detectAndParse(buffer);
}

/** Detect file type from magic bytes and parse accordingly. */
async function detectAndParse(buffer: Buffer): Promise<string | null> {
  if (buffer.length < 4) return null;

  // PDF: starts with %PDF
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return parsePdf(buffer);
  }

  // ZIP-based formats (DOCX, XLSX, ODT): starts with PK
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    return parseWord(buffer);
  }

  // OLE2 format (old .doc, .xls, .ppt): starts with D0 CF 11 E0
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) {
    return parseWord(buffer);
  }

  // Plain text: check if buffer is mostly printable ASCII/UTF-8
  const sample = buffer.slice(0, Math.min(buffer.length, 512));
  const printable = sample.filter(b => (b >= 0x20 && b < 0x7f) || b === 0x0a || b === 0x0d || b === 0x09 || b > 0x7f);
  if (printable.length > sample.length * 0.9) {
    const text = decodeText(buffer).trim();
    if (text.length > 10) return text;
  }

  return null;
}

function decodeText(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("gbk", { fatal: false }).decode(buffer);
  }
}

async function parsePdf(buffer: Buffer): Promise<string | null> {
  try {
    const pdfParse = require("pdf-parse") as (
      input: Buffer
    ) => Promise<{ text?: string }>;
    const result = await pdfParse(buffer);
    return result.text?.trim() || null;
  } catch (err) {
    console.warn("PDF parse error:", String(err));
    return null;
  }
}

async function parseWord(buffer: Buffer): Promise<string | null> {
  try {
    const mammoth = require("mammoth") as {
      extractRawText(input: { buffer: Buffer }): Promise<{ value?: string }>;
    };
    const result = await mammoth.extractRawText({ buffer });
    return result.value?.trim() || null;
  } catch (err) {
    console.warn("Word parse error:", String(err));
    return null;
  }
}

function inferContentType(url: string): string | undefined {
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.endsWith(".html") || pathname.endsWith(".htm")) return "text/html";
  if (pathname.endsWith(".txt")) return "text/plain";
  if (pathname.endsWith(".pdf")) return "application/pdf";
  if (pathname.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (pathname.endsWith(".doc")) return "application/msword";
  if (pathname.endsWith(".zip")) return "application/zip";
  return undefined;
}
