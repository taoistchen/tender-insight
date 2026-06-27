# Tender Insight MVP Design

## Goal

Build the first usable version of an engineering tender screening system for Jiangsu Yayi Construction Group. The MVP ingests tender notices, stores company capability data, compares notice requirements against company qualifications and preferences, and shows traceable recommendations.

## Scope

The MVP is intentionally narrow:

- Start with Nanjing construction tender notices.
- Store company profile, qualifications, personnel, performance records, tender notices, and analysis results.
- Support manual entry for company capability data.
- Parse basic tender fields from notice text.
- Use deterministic rules for recommendation decisions.
- Use AI later only for structured extraction and summary generation.

Out of scope for the first build:

- OCR for uploaded certificates.
- Attachment parsing.
- WeCom or DingTalk push.
- All four city crawlers at once.
- AI-only tender decisions.

## Architecture

The project uses a TypeScript monorepo with separate `backend` and `frontend` folders.

The backend owns data models, crawler interfaces, parsing utilities, and rule analysis. The frontend owns the operational dashboard for tender lists, tender details, and company capability records. Shared behavior starts in backend code first because matching and parsing must be testable without a browser.

## Linux Deployment Requirements

The application must run on a Linux cloud server without Windows-specific assumptions:

- The backend listens on `HOST=0.0.0.0` and configurable `PORT`.
- Runtime configuration comes from environment variables and `.env` files, not hardcoded local paths.
- Docker files are provided for repeatable Linux deployment.
- A `/api/health` endpoint reports service status for load balancers and container health checks.
- File storage paths are relative to a configured data directory.
- Logs go to stdout/stderr so systemd, Docker, or cloud logging can collect them.

## Data Model

Core entities:

- `CompanyProfile`: company name, region, max project amount, preferred regions, preferred project types, excluded keywords, minimum remaining days.
- `CompanyQualification`: qualification name, level, validity dates, source file reference, raw text.
- `CompanyPersonnel`: person name, certificate type, major, level, validity, availability.
- `CompanyPerformance`: project name, type, region, amount, completion date, keywords.
- `TenderNotice`: source site, city, title, URL, publish time, deadline, budget, content text, status, content hash.
- `TenderAnalysis`: decision, score, rule result details, risk points, matched points, manual review flag.

## Recommendation Logic

Rules run before AI.

Hard rejection or not-recommended cases:

- City is outside preferred regions.
- Deadline has passed.
- Remaining days are lower than company preference.
- Tender title or content contains excluded keywords such as design, supervision, audit, or consulting.
- Budget exceeds maximum project amount.
- Explicit qualification requirements are not met.

Scored checks:

- Region match: 10 points.
- Project type match: 15 points.
- Qualification match: 25 points.
- Personnel match: 20 points.
- Performance match: 15 points.
- Amount fit: 10 points.
- Time fit: 5 points.

Decision mapping:

- Hard failure: `rejected`.
- Score 85-100: `recommended`.
- Score 70-84: `watch`.
- Score 50-69: `manual_review`.
- Score below 50: `not_recommended`.

## First Company Capability Seed

The certificate image in `Assets/公司资质.jpg` identifies these initial qualifications:

- 建筑工程施工总承包 贰级, valid to 2030-03-12.
- 消防设施工程专业承包 贰级, valid to 2027-04-20.
- 防水防腐保温工程专业承包 贰级, valid to 2027-04-20.
- 建筑装修装饰工程专业承包 贰级, valid to 2027-04-20.
- 特种工程（结构补强）专业承包 不分等级, valid to 2027-04-20.

The initial matching profile should prioritize building, fire protection, decoration, waterproofing, corrosion protection, insulation, renovation, and structural strengthening projects. It should not recommend municipal road projects unless matching municipal qualifications are later entered.

## Testing Strategy

Use TDD for rule and parsing behavior:

- Qualification level comparison.
- Tender text field extraction.
- Analysis decision mapping.
- Excluded keyword handling.
- Deadline and remaining-day handling.

Frontend tests can be added after the first stable API contract exists. The first verification target is backend unit tests plus TypeScript type checking.
