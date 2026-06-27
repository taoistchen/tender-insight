import type {
  TenderAttachment,
  TenderResolvedLink
} from "../domain/types.js";

const DOCUMENT_EXTENSIONS =
  /\.(?:pdf|doc|docx|xls|xlsx|zip|rar|7z|txt)(?:[?#].*)?$/i;

const DOCUMENT_KEYWORDS = [
  "招标文件",
  "采购文件",
  "招标资料",
  "附件",
  "下载",
  "tender document",
  "tender file",
  "download",
  "attachment"
];

const DETAIL_KEYWORDS = [
  "公告",
  "正文",
  "详情",
  "内容",
  "下一页",
  "第2页",
  "tender notice",
  "notice detail",
  "detail"
];

export interface DeepDetailOptions {
  entryUrl: string;
  initialHtml: string;
  fetchText: (url: string) => Promise<string>;
  maxDepth?: number;
}

export interface DeepDetailResult {
  sourceHtml: string;
  contentHtml: string;
  contentText: string;
  resolvedLinks: TenderResolvedLink[];
  attachments: TenderAttachment[];
}

export async function extractDeepTenderDetail(
  options: DeepDetailOptions
): Promise<DeepDetailResult> {
  const maxDepth = options.maxDepth ?? 1;
  const visited = new Set<string>([options.entryUrl]);
  const allLinks: TenderResolvedLink[] = [];
  const attachments = new Map<string, TenderAttachment>();

  const firstContentHtml = extractMainContentHtml(options.initialHtml);
  const textParts = [htmlToText(firstContentHtml)];
  const firstLinks = extractLinksFromHtml(firstContentHtml, options.entryUrl);
  allLinks.push(...firstLinks);

  for (const link of firstLinks) {
    if (link.kind === "document") {
      attachments.set(link.url, {
        url: link.url,
        label: link.label,
        sourcePageUrl: link.sourcePageUrl,
        status: "linked"
      });
      continue;
    }

    if (link.kind !== "detail" || maxDepth < 1 || visited.has(link.url)) {
      continue;
    }

    visited.add(link.url);
    try {
      const linkedHtml = await options.fetchText(link.url);
      const linkedContentHtml = extractMainContentHtml(linkedHtml);
      const linkedText = htmlToText(linkedContentHtml);
      if (linkedText) {
        textParts.push(linkedText);
      }

      const nestedLinks = extractLinksFromHtml(linkedContentHtml, link.url);
      allLinks.push(...nestedLinks);
      for (const nested of nestedLinks) {
        if (nested.kind === "document") {
          attachments.set(nested.url, {
            url: nested.url,
            label: nested.label,
            sourcePageUrl: nested.sourcePageUrl,
            status: "linked"
          });
        }
      }
    } catch (err) {
      allLinks.push({
        ...link,
        label: `${link.label || link.url} (fetch failed: ${String(err)})`
      });
    }
  }

  return {
    sourceHtml: options.initialHtml,
    contentHtml: firstContentHtml,
    contentText: joinUniqueText(textParts),
    resolvedLinks: dedupeLinks(allLinks),
    attachments: [...attachments.values()]
  };
}

export function extractMainContentHtml(html: string): string {
  const preferredStart = findPreferredBlockStart(html);
  if (preferredStart >= 0) {
    const block = extractBalancedElement(html, preferredStart);
    if (block) return block;
  }

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch ? bodyMatch[1] : html;
}

export function extractLinksFromHtml(
  html: string,
  sourcePageUrl: string
): TenderResolvedLink[] {
  const links: TenderResolvedLink[] = [];

  const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let anchorMatch;
  while ((anchorMatch = anchorRegex.exec(html)) !== null) {
    const href = getAttribute(anchorMatch[1], "href");
    if (!href || href.startsWith("javascript:") || href.startsWith("#")) {
      continue;
    }
    const label =
      cleanText(stripTags(anchorMatch[2])) ||
      getAttribute(anchorMatch[1], "title") ||
      href;
    links.push(makeLink(href, label, sourcePageUrl, false));
  }

  const frameRegex = /<(?:iframe|frame)\b([^>]*)>/gi;
  let frameMatch;
  while ((frameMatch = frameRegex.exec(html)) !== null) {
    const src = getAttribute(frameMatch[1], "src");
    if (!src || src.startsWith("javascript:") || src.startsWith("#")) {
      continue;
    }
    const label =
      getAttribute(frameMatch[1], "title") ||
      getAttribute(frameMatch[1], "name") ||
      "embedded detail";
    links.push(makeLink(src, label, sourcePageUrl, true));
  }

  return dedupeLinks(links);
}

export function htmlToText(html: string): string {
  return cleanText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<\/(?:div|p|h\d|li|tr|td|th|br|section|article)[^>]*>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
  );
}

function makeLink(
  rawUrl: string,
  rawLabel: string,
  sourcePageUrl: string,
  forceDetail: boolean
): TenderResolvedLink {
  const url = new URL(rawUrl, sourcePageUrl).toString();
  const label = cleanText(rawLabel);
  const haystack = `${label} ${url}`.toLowerCase();
  const sourceHost = new URL(sourcePageUrl).host;
  const targetHost = new URL(url).host;

  let kind: TenderResolvedLink["kind"] = "other";
  if (isDocumentLink(haystack)) {
    kind = "document";
  } else if (forceDetail || isDetailLink(haystack)) {
    kind = "detail";
  } else if (sourceHost !== targetHost) {
    kind = "external";
  }

  return { url, label, sourcePageUrl, kind };
}

function isDocumentLink(haystack: string): boolean {
  return (
    DOCUMENT_EXTENSIONS.test(haystack) ||
    DOCUMENT_KEYWORDS.some((keyword) => haystack.includes(keyword.toLowerCase()))
  );
}

function isDetailLink(haystack: string): boolean {
  return (
    /\.html?(?:[?#].*)?$/i.test(haystack) &&
    DETAIL_KEYWORDS.some((keyword) => haystack.includes(keyword.toLowerCase()))
  );
}

function findPreferredBlockStart(html: string): number {
  const patterns = [
    /<(div|article|section)\b[^>]*(?:class|id)=["'][^"']*(?:con|content|article|detail|main)[^"']*["'][^>]*>/i,
    /<article\b[^>]*>/i,
    /<main\b[^>]*>/i
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.index !== undefined) return match.index;
  }
  return -1;
}

function extractBalancedElement(html: string, start: number): string | null {
  const openTag = html.slice(start).match(/^<([a-z0-9]+)\b[^>]*>/i);
  if (!openTag) return null;
  const tagName = openTag[1];
  const tagRegex = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "gi");
  tagRegex.lastIndex = start;

  let depth = 0;
  let match;
  while ((match = tagRegex.exec(html)) !== null) {
    if (match[0].startsWith("</")) {
      depth--;
      if (depth === 0) {
        return html.slice(start, tagRegex.lastIndex);
      }
    } else if (!match[0].endsWith("/>")) {
      depth++;
    }
  }

  return null;
}

function getAttribute(attrs: string, name: string): string | null {
  const quoted = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(attrs);
  if (quoted) return quoted[1].trim();
  const unquoted = new RegExp(`${name}\\s*=\\s*([^\\s>]+)`, "i").exec(attrs);
  return unquoted ? unquoted[1].trim() : null;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

function cleanText(text: string): string {
  return text
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function joinUniqueText(parts: string[]): string {
  const seen = new Set<string>();
  const unique = parts.filter((part) => {
    const normalized = part.trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
  return unique.join("\n\n");
}

function dedupeLinks(links: TenderResolvedLink[]): TenderResolvedLink[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = `${link.kind}|${link.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
