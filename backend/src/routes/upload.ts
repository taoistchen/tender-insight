import type { Request } from "express";
import { Router } from "express";
import multer from "multer";
import {
  addQualification,
  addPersonnel,
  addPerformance,
  getProfile,
  upsertProfile,
} from "../db/company-repo.js";
import { AI_MODEL, AI_BASE_URL, getAiApiKey } from "../ai/config.js";

export const uploadRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
});

/* ─── Unified extracted types ─── */

interface ExtractedQual {
  name: string;
  level: string;
  validTo: string | null;
  confidence: "high" | "medium" | "low";
}

interface ExtractedPersonnel {
  personName: string;
  certificateType: string | null;
  major: string | null;
  level: string | null;
  validTo: string | null;
  confidence: "high" | "medium" | "low";
}

interface ExtractedPerformance {
  projectName: string;
  projectType: string | null;
  amount: number | null;
  completionDate: string | null;
  confidence: "high" | "medium" | "low";
}

interface ExtractedPreferences {
  preferredRegions: string[];
  preferredProjectTypes: string[];
  excludedKeywords: string[];
}

interface UnifiedExtraction {
  qualifications: ExtractedQual[];
  personnel: ExtractedPersonnel[];
  performances: ExtractedPerformance[];
  preferences: ExtractedPreferences | null;
}

interface UploadedMemoryFile {
  originalname: string;
  mimetype?: string;
  buffer: Buffer;
}

type MulterFilesRequest = Request & {
  files?: UploadedMemoryFile[];
};

/* ─── Unified AI prompt ─── */

const UNIFIED_PROMPT = `你是一个建筑企业资质文件解析器。请从上传的资质证书、人员证书、业绩合同等文件中提取以下四类信息。
只返回JSON，不要任何解释或markdown。

返回格式：
{
  "qualifications": [
    {"name": "资质名称,如建筑工程施工总承包", "level": "资质等级,如一级/二级/三级/甲级/乙级/不分等级", "validTo": "有效期截止日期YYYY-MM-DD,无则填null"}
  ],
  "personnel": [
    {"personName": "人员姓名", "certificateType": "证书类型,如一级建造师/二级建造师/安全员/工程师,无则null", "major": "专业,如建筑工程/市政公用/机电,无则null", "level": "等级,如一级/二级/A证/B证/C证,无则null", "validTo": "有效期YYYY-MM-DD,无则null"}
  ],
  "performances": [
    {"projectName": "项目名称", "projectType": "项目类型,如建筑工程/市政工程/装修工程,无则null", "amount": 合同金额数字(元),"completionDate": "完工日期YYYY-MM-DD,无则null"}
  ],
  "preferences": {
    "preferredRegions": ["从文件中能看出的常驻或主营业区域,如南京/淮安"],
    "preferredProjectTypes": ["从资质和业绩推断的擅长项目类型,如建筑/消防/装修"],
    "excludedKeywords": ["明显不应承接的项目类型,如监理/设计"]
  }
}

注意：
- 如果某类信息文件中完全没有，返回空数组[]或null
- preferences字段根据文件中所有信息综合推断，如果没有足够信息则返回null
- 只返回明确能从文件中识别的内容，不要编造`;

/* ─── Unified upload endpoint ─── */

uploadRouter.post(
  "/company/qualifications/upload",
  upload.array("files", 10),
  async (req, res) => {
    const files = (req as MulterFilesRequest).files;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "请选择文件" });
    }

    const aiKey = getAiApiKey();
    if (!aiKey) {
      return res.status(400).json({
        error:
          "未配置 AI_API_KEY 或 DEEPSEEK_API_KEY 环境变量，无法使用 AI 识别",
      });
    }

    // Build a multi-image message: all files + the unified prompt
    const content: { type: string; text?: string; image_url?: { url: string } }[] = [];

    for (const file of files) {
      const base64 = file.buffer.toString("base64");
      const mimeType = file.mimetype || "image/jpeg";

      // PDF files: convert to image via a note (vision API limitation)
      if (mimeType === "application/pdf") {
        content.push({
          type: "text",
          text: `[文件名: ${file.originalname} (PDF文档)]`,
        });
      }

      if (mimeType.startsWith("image/")) {
        content.push({
          type: "image_url",
          image_url: {
            url: `data:${mimeType};base64,${base64}`,
          },
        });
      }
    }

    // If no image files but we have PDFs, note it
    const imageCount = content.filter((c) => c.type === "image_url").length;
    if (imageCount === 0) {
      content.push({
        type: "text",
        text: "注意：上传的文件为PDF格式，当前仅通过文件名和元数据进行分析。建议上传JPG/PNG截图以获得更好的识别效果。",
      });
    }

    content.push({
      type: "text",
      text: UNIFIED_PROMPT,
    });

    let unifiedResult: UnifiedExtraction = {
      qualifications: [],
      personnel: [],
      performances: [],
      preferences: null,
    };

    try {
      const response = await fetch(AI_BASE_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${aiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [
            {
              role: "user",
              content,
            },
          ],
          max_tokens: 4000,
        }),
      });

      if (!response.ok) {
        console.warn(`AI API error: HTTP ${response.status}`);
      } else {
        const data = (await response.json()) as {
          choices: { message: { content: string } }[];
        };
        const text = data.choices[0].message.content.trim();

        // Parse JSON from AI response (may contain markdown code fences)
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
            unifiedResult = normalizeUnified(parsed);
          } catch {
            console.warn("Failed to parse AI response JSON");
          }
        }
      }
    } catch (err) {
      console.warn(`AI extraction failed: ${String(err)}`);
    }

    res.json({
      ...unifiedResult,
      totalFiles: files.length,
      analyzedFiles: files.filter(
        (f) =>
          f.mimetype?.startsWith("image/") || f.mimetype === "application/pdf"
      ).length,
    });
  }
);

function normalizeUnified(raw: Record<string, unknown>): UnifiedExtraction {
  const quals = normalizeQuals(raw.qualifications);
  const pers = normalizePersonnel(raw.personnel);
  const perfs = normalizePerformances(raw.performances);
  const prefs = normalizePreferences(raw.preferences);

  // Dedup by key
  return {
    qualifications: dedupQuals(quals),
    personnel: dedupPersonnel(pers),
    performances: dedupPerformances(perfs),
    preferences: prefs,
  };
}

/* ─── Normalize helpers ─── */

function normalizeQuals(raw: unknown): ExtractedQual[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (q) =>
        typeof q === "object" && q && typeof (q as Record<string, unknown>).name === "string"
    )
    .map((q) => {
      const o = q as Record<string, unknown>;
      return {
        name: String(o.name ?? "").trim(),
        level: String(o.level ?? "").trim(),
        validTo: typeof o.validTo === "string" ? o.validTo : null,
        confidence: "high" as const,
      };
    })
    .filter((q) => q.name && q.level);
}

function normalizePersonnel(raw: unknown): ExtractedPersonnel[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (p) =>
        typeof p === "object" &&
        p &&
        typeof (p as Record<string, unknown>).personName === "string"
    )
    .map((p) => {
      const o = p as Record<string, unknown>;
      return {
        personName: String(o.personName ?? "").trim(),
        certificateType:
          typeof o.certificateType === "string" ? o.certificateType : null,
        major: typeof o.major === "string" ? o.major : null,
        level: typeof o.level === "string" ? o.level : null,
        validTo: typeof o.validTo === "string" ? o.validTo : null,
        confidence: "high" as const,
      };
    })
    .filter((p) => p.personName);
}

function normalizePerformances(raw: unknown): ExtractedPerformance[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (p) =>
        typeof p === "object" &&
        p &&
        typeof (p as Record<string, unknown>).projectName === "string"
    )
    .map((p) => {
      const o = p as Record<string, unknown>;
      return {
        projectName: String(o.projectName ?? "").trim(),
        projectType:
          typeof o.projectType === "string" ? o.projectType : null,
        amount: typeof o.amount === "number" ? o.amount : null,
        completionDate:
          typeof o.completionDate === "string" ? o.completionDate : null,
        confidence: "high" as const,
      };
    })
    .filter((p) => p.projectName);
}

function normalizePreferences(
  raw: unknown
): ExtractedPreferences | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const regions = Array.isArray(o.preferredRegions)
    ? o.preferredRegions.filter((s): s is string => typeof s === "string")
    : [];
  const types = Array.isArray(o.preferredProjectTypes)
    ? o.preferredProjectTypes.filter((s): s is string => typeof s === "string")
    : [];
  const exclude = Array.isArray(o.excludedKeywords)
    ? o.excludedKeywords.filter((s): s is string => typeof s === "string")
    : [];
  // Return null if all empty
  if (regions.length === 0 && types.length === 0 && exclude.length === 0)
    return null;
  return { preferredRegions: regions, preferredProjectTypes: types, excludedKeywords: exclude };
}

/* ─── Dedup helpers ─── */

function dedupQuals(items: ExtractedQual[]): ExtractedQual[] {
  const seen = new Set<string>();
  return items.filter((q) => {
    const key = `${q.name}|${q.level}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupPersonnel(items: ExtractedPersonnel[]): ExtractedPersonnel[] {
  const seen = new Set<string>();
  return items.filter((p) => {
    const key = `${p.personName}|${p.certificateType ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupPerformances(items: ExtractedPerformance[]): ExtractedPerformance[] {
  const seen = new Set<string>();
  return items.filter((p) => {
    const key = p.projectName;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ─── Unified confirm endpoint ─── */

/** Confirm and save ALL extracted data categories at once. */
uploadRouter.post("/company/qualifications/confirm", async (req, res) => {
  const body = req.body as {
    qualifications?: { name: string; level: string; validTo?: string }[];
    personnel?: {
      personName: string;
      certificateType?: string;
      major?: string;
      level?: string;
      validTo?: string;
    }[];
    performances?: {
      projectName: string;
      projectType?: string;
      amount?: number;
      completionDate?: string;
    }[];
    preferences?: {
      preferredRegions?: string[];
      preferredProjectTypes?: string[];
      excludedKeywords?: string[];
    };
  };

  const saved: Record<string, unknown> = {};

  // Save qualifications
  if (Array.isArray(body.qualifications) && body.qualifications.length > 0) {
    const qualResults: { id: number; name: string; level: string }[] = [];
    for (const q of body.qualifications) {
      if (!q.name || !q.level) continue;
      const result = await addQualification(q);
      qualResults.push({
        id: result.id,
        name: result.name,
        level: result.level,
      });
    }
    saved.qualifications = qualResults;
  }

  // Save personnel
  if (Array.isArray(body.personnel) && body.personnel.length > 0) {
    const persResults: { id: number; personName: string }[] = [];
    for (const p of body.personnel) {
      if (!p.personName) continue;
      const result = await addPersonnel(p);
      persResults.push({
        id: result.id,
        personName: result.personName,
      });
    }
    saved.personnel = persResults;
  }

  // Save performances
  if (Array.isArray(body.performances) && body.performances.length > 0) {
    const perfResults: { id: number; projectName: string }[] = [];
    for (const p of body.performances) {
      if (!p.projectName) continue;
      const result = await addPerformance(p);
      perfResults.push({
        id: result.id,
        projectName: result.projectName,
      });
    }
    saved.performances = perfResults;
  }

  // Save preferences (merge with existing)
  if (body.preferences) {
    const regions = body.preferences.preferredRegions;
    const types = body.preferences.preferredProjectTypes;
    const keywords = body.preferences.excludedKeywords;
    if (
      (regions && regions.length > 0) ||
      (types && types.length > 0) ||
      (keywords && keywords.length > 0)
    ) {
      // Get current profile to merge
      const current = await getProfile();
      const merged = {
        companyName: current?.companyName ?? "",
        preferredRegions: regions && regions.length > 0
          ? regions
          : (current?.preferredRegions ?? []),
        preferredProjectTypes: types && types.length > 0
          ? types
          : (current?.preferredProjectTypes ?? []),
        excludedKeywords: keywords && keywords.length > 0
          ? keywords
          : (current?.excludedKeywords ?? []),
      };
      if (current) {
        await upsertProfile({
          ...merged,
          maxProjectAmount: current.maxProjectAmount,
          minProjectAmount: current.minProjectAmount,
          minRemainingDays: current.minRemainingDays,
        });
      } else {
        await upsertProfile(merged);
      }
      saved.preferences = merged;
    }
  }

  res.status(201).json({ saved });
});
