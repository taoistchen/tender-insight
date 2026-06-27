import { pool } from "./pool.js";
import type { CompanyProfile as AnalysisCompanyProfile } from "../domain/types.js";

/* ─── Types ─── */

export interface CompanyProfile {
  id: number;
  companyName: string;
  maxProjectAmount: number;
  minProjectAmount: number;
  minRemainingDays: number;
  preferredRegions: string[];
  preferredProjectTypes: string[];
  excludedKeywords: string[];
}

export interface CompanyQualification {
  id: number;
  name: string;
  level: string;
  validTo: string | null;
}

export interface CompanyPersonnel {
  id: number;
  personName: string;
  certificateType: string | null;
  major: string | null;
  level: string | null;
  validTo: string | null;
}

export interface CompanyPerformance {
  id: number;
  projectName: string;
  projectType: string | null;
  amount: number | null;
  completionDate: string | null;
}

/* ─── Profile ─── */

export async function getProfile(): Promise<CompanyProfile | null> {
  const result = await pool.query(
    "SELECT * FROM company_profile ORDER BY id LIMIT 1"
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0] as Record<string, unknown>;
  return {
    id: r.id as number,
    companyName: r.company_name as string,
    maxProjectAmount: Number(r.max_project_amount),
    minProjectAmount: Number(r.min_project_amount ?? 0),
    minRemainingDays: r.min_remaining_days as number,
    preferredRegions: (r.preferred_regions as string[]) ?? [],
    preferredProjectTypes: (r.preferred_project_types as string[]) ?? [],
    excludedKeywords: (r.excluded_keywords as string[]) ?? []
  };
}

export async function upsertProfile(data: {
  companyName: string;
  maxProjectAmount?: number;
  minProjectAmount?: number;
  minRemainingDays?: number;
  preferredRegions?: string[];
  preferredProjectTypes?: string[];
  excludedKeywords?: string[];
}): Promise<CompanyProfile> {
  const existing = await getProfile();
  if (existing) {
    const r = await pool.query(
      `UPDATE company_profile SET
         company_name = COALESCE($2, company_name),
         max_project_amount = COALESCE($3, max_project_amount),
         min_project_amount = COALESCE($4, min_project_amount),
         min_remaining_days = COALESCE($5, min_remaining_days),
         preferred_regions = COALESCE($6, preferred_regions),
         preferred_project_types = COALESCE($7, preferred_project_types),
         excluded_keywords = COALESCE($8, excluded_keywords),
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [
        existing.id, data.companyName, data.maxProjectAmount,
        data.minProjectAmount, data.minRemainingDays, data.preferredRegions,
        data.preferredProjectTypes, data.excludedKeywords
      ]
    );
    return rowToProfile(r.rows[0] as Record<string, unknown>);
  }
  const r = await pool.query(
    `INSERT INTO company_profile
       (company_name, max_project_amount, min_project_amount, min_remaining_days,
        preferred_regions, preferred_project_types, excluded_keywords)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      data.companyName, data.maxProjectAmount ?? 20_000_000,
      data.minProjectAmount ?? 0, data.minRemainingDays ?? 5,
      data.preferredRegions ?? [],
      data.preferredProjectTypes ?? [],
      data.excludedKeywords ?? []
    ]
  );
  return rowToProfile(r.rows[0] as Record<string, unknown>);
}

function rowToProfile(r: Record<string, unknown>): CompanyProfile {
  return {
    id: r.id as number,
    companyName: r.company_name as string,
    maxProjectAmount: Number(r.max_project_amount),
    minProjectAmount: Number(r.min_project_amount ?? 0),
    minRemainingDays: r.min_remaining_days as number,
    preferredRegions: (r.preferred_regions as string[]) ?? [],
    preferredProjectTypes: (r.preferred_project_types as string[]) ?? [],
    excludedKeywords: (r.excluded_keywords as string[]) ?? []
  };
}

/* ─── Qualifications ─── */

export async function getQualifications(): Promise<CompanyQualification[]> {
  const r = await pool.query(
    "SELECT * FROM company_qualification ORDER BY id"
  );
  return r.rows.map(rowToQual);
}

export async function addQualification(data: {
  name: string; level: string; validTo?: string;
}): Promise<CompanyQualification> {
  const r = await pool.query(
    `INSERT INTO company_qualification (name, level, valid_to)
     VALUES ($1,$2,$3) RETURNING *`,
    [data.name, data.level, data.validTo ?? null]
  );
  return rowToQual(r.rows[0] as Record<string, unknown>);
}

export async function updateQualification(
  id: number, data: { name?: string; level?: string; validTo?: string }
): Promise<CompanyQualification | null> {
  const r = await pool.query(
    `UPDATE company_qualification SET
       name = COALESCE($2, name),
       level = COALESCE($3, level),
       valid_to = COALESCE($4, valid_to)
     WHERE id = $1 RETURNING *`,
    [id, data.name ?? null, data.level ?? null, data.validTo ?? null]
  );
  return r.rows.length ? rowToQual(r.rows[0] as Record<string, unknown>) : null;
}

export async function deleteQualification(id: number): Promise<boolean> {
  const r = await pool.query(
    "DELETE FROM company_qualification WHERE id = $1", [id]
  );
  return (r.rowCount ?? 0) > 0;
}

function rowToQual(r: Record<string, unknown>): CompanyQualification {
  return {
    id: r.id as number,
    name: r.name as string,
    level: r.level as string,
    validTo: (r.valid_to as string) ?? null
  };
}

/* ─── Personnel ─── */

export async function getPersonnel(): Promise<CompanyPersonnel[]> {
  const r = await pool.query("SELECT * FROM company_personnel ORDER BY id");
  return r.rows.map(rowToPers);
}

export async function addPersonnel(data: {
  personName: string; certificateType?: string;
  major?: string; level?: string; validTo?: string;
}): Promise<CompanyPersonnel> {
  const r = await pool.query(
    `INSERT INTO company_personnel (person_name, certificate_type, major, level, valid_to)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [data.personName, data.certificateType ?? null, data.major ?? null,
     data.level ?? null, data.validTo ?? null]
  );
  return rowToPers(r.rows[0] as Record<string, unknown>);
}

export async function updatePersonnel(
  id: number, data: {
    personName?: string; certificateType?: string;
    major?: string; level?: string; validTo?: string;
  }
): Promise<CompanyPersonnel | null> {
  const r = await pool.query(
    `UPDATE company_personnel SET
       person_name = COALESCE($2, person_name),
       certificate_type = COALESCE($3, certificate_type),
       major = COALESCE($4, major),
       level = COALESCE($5, level),
       valid_to = COALESCE($6, valid_to)
     WHERE id = $1 RETURNING *`,
    [id, data.personName ?? null, data.certificateType ?? null,
     data.major ?? null, data.level ?? null, data.validTo ?? null]
  );
  return r.rows.length ? rowToPers(r.rows[0] as Record<string, unknown>) : null;
}

export async function deletePersonnel(id: number): Promise<boolean> {
  const r = await pool.query("DELETE FROM company_personnel WHERE id = $1", [id]);
  return (r.rowCount ?? 0) > 0;
}

function rowToPers(r: Record<string, unknown>): CompanyPersonnel {
  return {
    id: r.id as number,
    personName: r.person_name as string,
    certificateType: (r.certificate_type as string) ?? null,
    major: (r.major as string) ?? null,
    level: (r.level as string) ?? null,
    validTo: (r.valid_to as string) ?? null
  };
}

/* ─── Performance ─── */

export async function getPerformances(): Promise<CompanyPerformance[]> {
  const r = await pool.query("SELECT * FROM company_performance ORDER BY id");
  return r.rows.map(rowToPerf);
}

export async function getCompanyProfileForAnalysis(): Promise<AnalysisCompanyProfile | null> {
  const profile = await getProfile();
  if (!profile) return null;

  const [qualifications, personnel, performances] = await Promise.all([
    getQualifications(),
    getPersonnel(),
    getPerformances()
  ]);

  return {
    companyName: profile.companyName,
    maxProjectAmount: profile.maxProjectAmount,
    minProjectAmount: profile.minProjectAmount,
    minRemainingDays: profile.minRemainingDays,
    preferredRegions: profile.preferredRegions,
    preferredProjectTypes: profile.preferredProjectTypes,
    excludedKeywords: profile.excludedKeywords,
    qualifications: qualifications.map((q) => ({
      name: q.name,
      level: q.level,
      validTo: q.validTo ? new Date(`${q.validTo}T00:00:00+08:00`) : undefined
    })),
    personnel: personnel.map((p) => ({
      personName: p.personName,
      certificateType: p.certificateType ?? undefined,
      major: p.major ?? undefined,
      level: p.level ?? undefined,
      validTo: p.validTo ? new Date(`${p.validTo}T00:00:00+08:00`) : undefined
    })),
    performances: performances.map((p) => ({
      projectName: p.projectName,
      projectType: p.projectType ?? undefined,
      amount: p.amount ?? undefined,
      completionDate: p.completionDate
        ? new Date(`${p.completionDate}T00:00:00+08:00`)
        : undefined
    }))
  };
}

export async function addPerformance(data: {
  projectName: string; projectType?: string;
  amount?: number; completionDate?: string;
}): Promise<CompanyPerformance> {
  const r = await pool.query(
    `INSERT INTO company_performance (project_name, project_type, amount, completion_date)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [data.projectName, data.projectType ?? null,
     data.amount ?? null, data.completionDate ?? null]
  );
  return rowToPerf(r.rows[0] as Record<string, unknown>);
}

export async function updatePerformance(
  id: number, data: {
    projectName?: string; projectType?: string;
    amount?: number; completionDate?: string;
  }
): Promise<CompanyPerformance | null> {
  const r = await pool.query(
    `UPDATE company_performance SET
       project_name = COALESCE($2, project_name),
       project_type = COALESCE($3, project_type),
       amount = COALESCE($4, amount),
       completion_date = COALESCE($5, completion_date)
     WHERE id = $1 RETURNING *`,
    [id, data.projectName ?? null, data.projectType ?? null,
     data.amount ?? null, data.completionDate ?? null]
  );
  return r.rows.length ? rowToPerf(r.rows[0] as Record<string, unknown>) : null;
}

export async function deletePerformance(id: number): Promise<boolean> {
  const r = await pool.query("DELETE FROM company_performance WHERE id = $1", [id]);
  return (r.rowCount ?? 0) > 0;
}

function rowToPerf(r: Record<string, unknown>): CompanyPerformance {
  return {
    id: r.id as number,
    projectName: r.project_name as string,
    projectType: (r.project_type as string) ?? null,
    amount: r.amount ? Number(r.amount) : null,
    completionDate: (r.completion_date as string) ?? null
  };
}

/* ─── Seed ─── */

export async function seedIfEmpty(): Promise<void> {
  const existing = await getProfile();
  if (existing) return;

  await upsertProfile({
    companyName: "江苏亚亿建设集团有限公司",
    maxProjectAmount: 20_000_000,
    minProjectAmount: 0,
    minRemainingDays: 5,
    preferredRegions: ["南京", "淮安", "镇江", "连云港"],
    preferredProjectTypes: ["建筑", "消防", "装修", "防水", "防腐", "保温", "结构补强", "改造"],
    excludedKeywords: ["监理", "设计", "勘察", "审计", "造价咨询"]
  });

  const quals = [
    { name: "建筑工程施工总承包", level: "二级", validTo: "2030-03-12" },
    { name: "消防设施工程专业承包", level: "二级", validTo: "2027-04-20" },
    { name: "防水防腐保温工程专业承包", level: "二级", validTo: "2027-04-20" },
    { name: "建筑装修装饰工程专业承包", level: "二级", validTo: "2027-04-20" },
    { name: "特种工程（结构补强）专业承包", level: "不分等级", validTo: "2027-04-20" }
  ];
  for (const q of quals) await addQualification(q);

  console.log("Company seed data inserted");
}
