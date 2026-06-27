# Tender Deep Crawl Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deep tender detail extraction, tender document tracking, document text extraction, real company-profile matching, and crawler pagination fixes.

**Architecture:** Keep site crawlers responsible for list/detail entry URLs, and add shared tender modules for HTML deep extraction, document fetching/parsing, and company-profile assembly. Persist tender document metadata beside existing tender rows without breaking current API responses.

**Tech Stack:** Node 20, TypeScript, Express, PostgreSQL, Vitest, native fetch.

---

### Task 1: Fix Build Dependency and Upload Typing

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/src/routes/upload.ts`

- [ ] Add/verify `multer` runtime dependency and `@types/multer` dev dependency.
- [ ] Type uploaded files through an explicit local request interface so `req.files` compiles under strict TypeScript.
- [ ] Run `npm run typecheck -w backend` and confirm upload errors are gone.

### Task 2: Add Tender Document Domain and Persistence

**Files:**
- Modify: `backend/src/domain/types.ts`
- Modify: `backend/src/db/schema.ts`
- Modify: `backend/src/db/tender-repo.ts`

- [ ] Add `TenderAttachment` and resolved-link fields to tender domain types.
- [ ] Add `tender_document` table with URL, label, source page, content type, status, text, and error fields.
- [ ] Upsert tender documents when tender notices are saved.
- [ ] Load tender documents when tenders are read.

### Task 3: Add Shared Deep Detail Extraction

**Files:**
- Create: `backend/src/tender/detail-extraction.ts`
- Test: `backend/src/tender/__tests__/detail-extraction.test.ts`

- [ ] Write failing tests for iframe/tab/pagination links and tender-document link classification.
- [ ] Implement main-content extraction, HTML-to-text conversion, URL resolution, and keyword classification.
- [ ] Ensure extracted linked text is appended to `contentText` before field extraction.

### Task 4: Add Tender Document Fetching and Text Extraction

**Files:**
- Create: `backend/src/tender/document-fetcher.ts`
- Test: `backend/src/tender/__tests__/document-fetcher.test.ts`

- [ ] Write failing tests for HTML document parsing, unsupported binary document status, and failed downloads.
- [ ] Implement bounded document fetch with content type detection.
- [ ] Extract text from HTML/TXT immediately and persist unsupported binary links for manual follow-up.

### Task 5: Wire Deep Extraction Into Site Crawlers

**Files:**
- Modify: `backend/src/crawler/sites/nanjing.ts`
- Modify: `backend/src/crawler/sites/lianyungang.ts`
- Modify: `backend/src/crawler/sites/zhenjiang.ts`
- Modify: `backend/src/crawler/sites/huaian.ts`

- [ ] Replace per-site detail body scraping with the shared deep extraction helper.
- [ ] Preserve existing list parsing and site-specific deadline fallbacks.
- [ ] Add linked detail/document text to the final field extraction input.

### Task 6: Use Real Company Profile and Match Personnel/Performance

**Files:**
- Modify: `backend/src/db/company-repo.ts`
- Modify: `backend/src/crawler/service.ts`
- Modify: `backend/src/analysis/analyze-tender.ts`
- Test: `backend/src/analysis/__tests__/analyze-tender.test.ts`

- [ ] Add a company-profile assembler that includes qualifications, personnel, and performances.
- [ ] Update crawl-time analysis to use database company data when available, seed fallback only when DB is unavailable.
- [ ] Match personnel requirements against company personnel certificate/major/level.
- [ ] Match performance requirements against company performance project name/type/amount.

### Task 7: Fix Listing Pagination and Verify

**Files:**
- Modify: `backend/src/crawler/sites/lianyungang.ts`
- Test: `backend/src/crawler/__tests__/crawler-pagination.test.ts`

- [ ] Use page-specific list URLs for Lianyungang and parse total pages from the pager.
- [ ] Run `npm run verify`.
- [ ] Fix any compile/test/build failures before reporting completion.
