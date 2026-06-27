import { pool } from "./pool.js";

const SCHEMA_SQL = `
-- Tender notices scraped from government platforms
CREATE TABLE IF NOT EXISTS tender_notice (
  id            SERIAL PRIMARY KEY,
  url           TEXT UNIQUE NOT NULL,
  city          VARCHAR(50) NOT NULL,
  title         TEXT NOT NULL,
  source_site   VARCHAR(100),
  content_text  TEXT,
  source_html   TEXT,
  budget_amount NUMERIC(18,2),
  deadline_time TIMESTAMPTZ,
  publish_date  DATE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Qualification requirements extracted from each tender
CREATE TABLE IF NOT EXISTS tender_qualification (
  id          SERIAL PRIMARY KEY,
  tender_id   INT REFERENCES tender_notice(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  level       VARCHAR(50)
);

-- Personnel requirements extracted from each tender
CREATE TABLE IF NOT EXISTS tender_personnel (
  id          SERIAL PRIMARY KEY,
  tender_id   INT REFERENCES tender_notice(id) ON DELETE CASCADE,
  requirement TEXT NOT NULL
);

-- Performance requirements extracted from each tender
CREATE TABLE IF NOT EXISTS tender_performance (
  id          SERIAL PRIMARY KEY,
  tender_id   INT REFERENCES tender_notice(id) ON DELETE CASCADE,
  requirement TEXT NOT NULL
);

-- Tender documents and linked files discovered from detail pages
CREATE TABLE IF NOT EXISTS tender_document (
  id              SERIAL PRIMARY KEY,
  tender_id       INT REFERENCES tender_notice(id) ON DELETE CASCADE,
  url             TEXT NOT NULL,
  label           TEXT,
  source_page_url TEXT,
  content_type    TEXT,
  status          VARCHAR(30) NOT NULL DEFAULT 'linked',
  text_content    TEXT,
  error           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tender_id, url)
);

-- Analysis result for each tender
CREATE TABLE IF NOT EXISTS tender_analysis (
  id                    SERIAL PRIMARY KEY,
  tender_id             INT REFERENCES tender_notice(id) ON DELETE CASCADE UNIQUE,
  decision              VARCHAR(50) NOT NULL,
  match_score           INT DEFAULT 0,
  matched_points        JSONB DEFAULT '[]',
  risk_points           JSONB DEFAULT '[]',
  manual_review_required BOOLEAN DEFAULT FALSE,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tender_city       ON tender_notice(city);
CREATE INDEX IF NOT EXISTS idx_tender_deadline    ON tender_notice(deadline_time);
CREATE INDEX IF NOT EXISTS idx_tender_created     ON tender_notice(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_decision  ON tender_analysis(decision);

-- ─── Company data ───

CREATE TABLE IF NOT EXISTS company_profile (
  id                   SERIAL PRIMARY KEY,
  company_name         VARCHAR(255) NOT NULL,
  max_project_amount   NUMERIC(18,2) DEFAULT 20000000,
  min_project_amount   NUMERIC(18,2) DEFAULT 0,
  min_remaining_days   INT DEFAULT 5,
  preferred_regions    TEXT[] DEFAULT '{}',
  preferred_project_types TEXT[] DEFAULT '{}',
  excluded_keywords    TEXT[] DEFAULT '{}',
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS company_qualification (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  level       VARCHAR(50) NOT NULL,
  valid_to    DATE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS company_personnel (
  id              SERIAL PRIMARY KEY,
  person_name     VARCHAR(100) NOT NULL,
  certificate_type VARCHAR(100),
  major           VARCHAR(100),
  level           VARCHAR(50),
  valid_to        DATE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS company_performance (
  id              SERIAL PRIMARY KEY,
  project_name    VARCHAR(255) NOT NULL,
  project_type    VARCHAR(100),
  amount          NUMERIC(18,2),
  completion_date DATE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
`;

export async function initSchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(SCHEMA_SQL);
    // Migration: add min_project_amount if column doesn't exist yet
    await client.query(
      `DO $$ BEGIN
         ALTER TABLE company_profile ADD COLUMN min_project_amount NUMERIC(18,2) DEFAULT 0;
       EXCEPTION WHEN duplicate_column THEN NULL;
       END $$;`
    );
    await client.query(
      `DO $$ BEGIN
         ALTER TABLE tender_notice ADD COLUMN source_html TEXT;
       EXCEPTION WHEN duplicate_column THEN NULL;
       END $$;`
    );
    console.log("Database schema initialized");
  } finally {
    client.release();
  }
}
