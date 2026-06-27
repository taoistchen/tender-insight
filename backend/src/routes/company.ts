import { Router } from "express";
import {
  getProfile, upsertProfile,
  getQualifications, addQualification, updateQualification, deleteQualification,
  getPersonnel, addPersonnel, updatePersonnel, deletePersonnel,
  getPerformances, addPerformance, updatePerformance, deletePerformance
} from "../db/company-repo.js";

export const companyRouter = Router();

/* ─── Profile ─── */

companyRouter.get("/company/profile", async (_req, res) => {
  const p = await getProfile();
  if (!p) return res.status(404).json({ error: "公司信息未配置" });
  const quals = await getQualifications();
  res.json({ ...p, qualifications: quals });
});

companyRouter.put("/company/profile", async (req, res) => {
  try {
    const p = await upsertProfile(req.body);
    res.json(p);
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

/* ─── Qualifications ─── */

companyRouter.get("/company/qualifications", async (_req, res) => {
  res.json(await getQualifications());
});

companyRouter.post("/company/qualifications", async (req, res) => {
  try {
    const q = await addQualification(req.body);
    res.status(201).json(q);
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

companyRouter.put("/company/qualifications/:id", async (req, res) => {
  const q = await updateQualification(Number(req.params.id), req.body);
  if (!q) return res.status(404).json({ error: "未找到" });
  res.json(q);
});

companyRouter.delete("/company/qualifications/:id", async (req, res) => {
  const ok = await deleteQualification(Number(req.params.id));
  res.status(ok ? 204 : 404).end();
});

/* ─── Personnel ─── */

companyRouter.get("/company/personnel", async (_req, res) => {
  res.json(await getPersonnel());
});

companyRouter.post("/company/personnel", async (req, res) => {
  try {
    const p = await addPersonnel(req.body);
    res.status(201).json(p);
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

companyRouter.put("/company/personnel/:id", async (req, res) => {
  const p = await updatePersonnel(Number(req.params.id), req.body);
  if (!p) return res.status(404).json({ error: "未找到" });
  res.json(p);
});

companyRouter.delete("/company/personnel/:id", async (req, res) => {
  const ok = await deletePersonnel(Number(req.params.id));
  res.status(ok ? 204 : 404).end();
});

/* ─── Performance ─── */

companyRouter.get("/company/performances", async (_req, res) => {
  res.json(await getPerformances());
});

companyRouter.post("/company/performances", async (req, res) => {
  try {
    const p = await addPerformance(req.body);
    res.status(201).json(p);
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

companyRouter.put("/company/performances/:id", async (req, res) => {
  const p = await updatePerformance(Number(req.params.id), req.body);
  if (!p) return res.status(404).json({ error: "未找到" });
  res.json(p);
});

companyRouter.delete("/company/performances/:id", async (req, res) => {
  const ok = await deletePerformance(Number(req.params.id));
  res.status(ok ? 204 : 404).end();
});
