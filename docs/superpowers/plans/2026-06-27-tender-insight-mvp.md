# Tender Insight MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a working MVP skeleton for tender notice screening with tested backend rule logic and a basic frontend shell.

**Architecture:** Use a TypeScript workspace with `backend` and `frontend`. Put deterministic parsing and matching in backend modules so they can be tested without infrastructure. Add crawler interfaces and seed company data, but defer live crawler hardening until the base app is in place. Keep runtime configuration Linux-friendly with env vars, `0.0.0.0` binding, health checks, and Docker deployment files.

**Tech Stack:** Node.js, TypeScript, Vitest, Express, Vite React.

---

### Task 1: Workspace Skeleton

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `README.md`
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/vitest.config.ts`
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/styles.css`
- Create: `.env.example`

- [ ] Add npm scripts for backend tests, backend typecheck, frontend build, and combined verification.
- [ ] Add a short README describing local setup and current MVP scope.
- [ ] Add Linux-compatible environment variable examples.
- [ ] Install dependencies after files exist.

### Task 2: Core Domain Types

**Files:**
- Test: `backend/src/domain/__tests__/qualification-level.test.ts`
- Create: `backend/src/domain/types.ts`
- Create: `backend/src/domain/qualification-level.ts`

- [ ] Write failing tests for Chinese qualification level ordering.
- [ ] Run the test and confirm it fails because the module is missing.
- [ ] Implement minimal level normalization and comparison.
- [ ] Run the test and confirm it passes.

### Task 3: Tender Text Extraction

**Files:**
- Test: `backend/src/tender/__tests__/extract-tender-fields.test.ts`
- Create: `backend/src/tender/extract-tender-fields.ts`

- [ ] Write failing tests for budget amount, deadline, and construction-period extraction.
- [ ] Run the test and confirm it fails because extraction is missing.
- [ ] Implement regex-based extraction for common Chinese tender text.
- [ ] Run the test and confirm it passes.

### Task 4: Analysis Rules

**Files:**
- Test: `backend/src/analysis/__tests__/analyze-tender.test.ts`
- Create: `backend/src/analysis/analyze-tender.ts`
- Create: `backend/src/seed/company-profile.ts`

- [ ] Write failing tests for recommended, rejected by excluded keyword, rejected by missing qualification, and manual review cases.
- [ ] Run the test and confirm it fails because analysis is missing.
- [ ] Implement deterministic rule scoring and decision mapping.
- [ ] Run the test and confirm it passes.

### Task 5: API Shell

**Files:**
- Create: `backend/src/server.ts`
- Create: `backend/src/routes/health.ts`
- Create: `backend/src/routes/tenders.ts`
- Create: `backend/src/config.ts`

- [ ] Add an Express server with `/api/health`, `/api/company/profile`, and `/api/tenders`.
- [ ] Return seeded company data and sample tender analysis.
- [ ] Bind to `HOST` and `PORT` environment variables, defaulting to `0.0.0.0` and `3001`.
- [ ] Typecheck the backend.

### Task 6: Linux Deployment Files

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `docker-compose.yml`

- [ ] Add a multi-stage Dockerfile that installs workspace dependencies, builds backend and frontend, and runs the backend on Linux.
- [ ] Add Docker Compose service definitions for app, PostgreSQL, and Redis.
- [ ] Add health check configuration using `/api/health`.

### Task 7: Frontend Shell

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles.css`

- [ ] Add dashboard metrics, tender list, and company capability panels.
- [ ] Keep the frontend using static sample data until API wiring is stable.
- [ ] Build the frontend.

### Task 8: Verification

**Files:**
- Modify only if verification exposes defects.

- [ ] Run backend tests.
- [ ] Run backend typecheck.
- [ ] Run frontend build.
- [ ] Build the Docker image if Docker is available.
- [ ] Report exact verification status.
