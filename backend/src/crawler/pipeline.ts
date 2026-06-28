/**
 * Unified Tender Extraction Pipeline
 * ==================================
 *
 * Codifies per-site extraction rules into a single automated flow.
 * No manual per-tender fixes — everything is configuration-driven.
 *
 * Pipeline flow for every crawled tender:
 *
 *   Page fetched by crawler
 *     ↓
 *   Phase 1: AI extraction from page HTML (15KB context window)
 *     → budget, deadline, pubDate, quals, personnel, performance
 *     ↓
 *   Phase 2 (auto): If budget/deadline missing → scan HTML for attachments
 *     → Download PDF/DOCX → parse → combine text → re-run AI
 *     ↓
 *   Phase 3 (auto): Regex fallback for any still-missing fields
 *     → 10+ budget patterns, 10+ deadline patterns
 *     ↓
 *   Phase 4 (post-crawl): Batch re-enrichment of any tenders still missing fields
 *     → Uses stored sourceHtml (no re-fetch needed)
 *     → Concurrent processing (CRAWL_CONCURRENCY)
 *     ↓
 *   Result: Tender stored with maximum possible data completeness
 *
 * ── Site-specific configurations ───────────────────────────
 */

export interface SitePipelineConfig {
  /** Human-readable site name */
  siteName: string;
  /** City for company matching */
  city: string;
  /** Crawler type: "html-list" (parse HTML pages) or "search-api" (POST to search API) */
  crawlerType: "html-list" | "search-api";
  /** URL of the listing page (page 1) */
  listUrl: string;
  /** URL pattern for paginated listing pages */
  pageUrlPattern: string;
  /** Regex to extract tender items from listing HTML */
  listItemPattern: string;
  /** Known page types that should be SKIPPED (not real tenders) */
  skipPatterns: RegExp;
  /** Category codes used in the listing URL (varies by site!) */
  categoryCodes: {
    tenderNotice: string; // 招标公告
    tenderPlan?: string;  // 招标计划 (optional)
  };
  /** Whether this site uses attachments (PDF/DOCX) for full tender body */
  usesAttachments: boolean;
  /** Known attachment URL patterns to detect */
  attachmentUrlPatterns: RegExp[];
  /** Whether the site is geo-restricted from the server */
  geoRestricted: boolean;
}

export const SITE_PIPELINES: Record<string, SitePipelineConfig> = {
  nanjing: {
    siteName: "南京市公共资源交易平台",
    city: "南京",
    crawlerType: "html-list",
    listUrl:
      "http://njggzy.nanjing.gov.cn/njweb/fjsz/068001/068001002/moreinfo.html",
    pageUrlPattern:
      "http://njggzy.nanjing.gov.cn/njweb/fjsz/068001/068001002/${page}.html",
    listItemPattern:
      '<li\\s+class="ewb-info-item2[^"]*"\\s+onclick="window\\.open\\(\'([^\']+)\'\\)[^"]*">([\\s\\S]*?)</li>',
    skipPatterns: /流标|废标|终止公告|终止招标|招标失败|采购失败|澄清修改公告/,
    categoryCodes: {
      tenderNotice: "001001002"
    },
    usesAttachments: true,
    attachmentUrlPatterns: [
      /\/njxm-prod\/api\/attach\/preview\?attachId=/i,
      /\/njweb\/attach\//i
    ],
    geoRestricted: false
  },

  lianyungang: {
    siteName: "连云港市公共资源交易平台",
    city: "连云港",
    crawlerType: "html-list",
    listUrl:
      "http://ggzy.lyg.gov.cn/lygweb/jyxx/001001/001001001/tradeInfo.html",
    pageUrlPattern:
      "http://ggzy.lyg.gov.cn/lygweb/jyxx/001001/001001001/${page}.html",
    // NOTE: Lianyungang uses 001001001 for 招标公告 (NOT 001001002 like other cities!)
    listItemPattern:
      '<a\\s+href="(\\/lygweb\\/jyxx\\/001001\\/001001001\\/\\d+\\/[a-z0-9-]+\\.html)"\\s+target="_blank"\\s+title="([^"]*)"',
    skipPatterns: /流标|废标|终止公告|终止招标|招标失败|采购失败/,
    categoryCodes: {
      tenderNotice: "001001001"
    },
    usesAttachments: false,
    attachmentUrlPatterns: [],
    geoRestricted: false
  },

  zhenjiang: {
    siteName: "镇江市公共资源交易平台",
    city: "镇江",
    crawlerType: "search-api",
    listUrl:
      "http://ggzy.zhenjiang.gov.cn/jyxx/tradeInfonew.html?type=gcjs",
    pageUrlPattern: "",
    listItemPattern: "",
    skipPatterns: /流标|废标|终止公告|终止招标|招标失败|采购失败/,
    categoryCodes: {
      tenderNotice: "001001002"
    },
    usesAttachments: false,
    attachmentUrlPatterns: [
      /\/WebbuilderMIS\/attach\//i
    ],
    geoRestricted: false
  },

  huaian: {
    siteName: "淮安市公共资源交易平台",
    city: "淮安",
    crawlerType: "html-list",
    listUrl: "https://ggzy.huaian.gov.cn/",
    pageUrlPattern: "",
    listItemPattern: "",
    skipPatterns: /流标|废标|终止公告|终止招标|招标失败|采购失败/,
    categoryCodes: {
      tenderNotice: "001001001"
    },
    usesAttachments: false,
    attachmentUrlPatterns: [],
    geoRestricted: true // Requires browser-based crawling
  }
};

/**
 * ── Automated Extraction Pipeline (invoked per tender) ──
 *
 * This is the core extraction logic, called from enrichTenderWithAI()
 * in extract-tender-fields.ts. The configuration above documents
 * site-specific rules; the actual extraction is:
 *
 *  1. AI primary (extractTenderFromPage)
 *  2. Attachment fallback (if budget missing + attachments exist)
 *  3. Regex fallback (extractTenderFields)
 *  4. Post-crawl batch enrichment (runPostCrawlEnrichment)
 *
 * All steps are automatic — no manual intervention needed.
 */
