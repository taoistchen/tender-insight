import { Router } from "express";
import multer from "multer";
import { addQualification } from "../db/company-repo.js";

export const uploadRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 }
});

const AI_MODEL = process.env["AI_MODEL"] ?? "deepseek-chat";
const AI_BASE_URL =
  process.env["AI_BASE_URL"] ?? "https://api.deepseek.com/v1/chat/completions";
const AI_API_KEY = process.env["AI_API_KEY"] ?? "";

interface ExtractedQual {
  name: string;
  level: string;
  validTo: string | null;
  confidence: "high" | "medium" | "low";
}

uploadRouter.post(
  "/company/qualifications/upload",
  upload.array("files", 10),
  async (req, res) => {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "请选择文件" });
    }

    const aiKey = AI_API_KEY || (process.env["KIMI_API_KEY"] ?? "");
    if (!aiKey) {
      return res.status(400).json({
        error: "未配置 AI_API_KEY 或 KIMI_API_KEY 环境变量，无法使用 AI 识别"
      });
    }

    const allExtracted: ExtractedQual[] = [];

    for (const file of files) {
      try {
        const base64 = file.buffer.toString("base64");
        const mimeType = file.mimetype || "image/jpeg";

        const response = await fetch(
          AI_BASE_URL,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${aiKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              model: AI_MODEL,
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "image_url",
                      image_url: {
                        url: `data:${mimeType};base64,${base64}`
                      }
                    },
                    {
                      type: "text",
                      text: `请从这张建筑企业资质证书中提取以下信息，以JSON格式返回。
只返回JSON数组，每个资质一个对象，不要任何解释。

格式：
[{
  "name": "资质名称，如建筑工程施工总承包",
  "level": "资质等级，如一级、二级、三级、甲级、乙级、不分等级",
  "validTo": "有效期截止日期，格式YYYY-MM-DD，如无则填null"
}]

如果图片不清晰或无法识别，返回空数组 []。`
                    }
                  ]
                }
              ],
              max_tokens: 2000
            })
          }
        );

        if (!response.ok) {
          console.warn(
            `Kimi API error for ${file.originalname}: HTTP ${response.status}`
          );
          continue;
        }

        const data = (await response.json()) as {
          choices: { message: { content: string } }[];
        };
        const text = data.choices[0].message.content.trim();

        // Parse JSON from AI response (may contain markdown code fences)
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as {
            name: string;
            level: string;
            validTo: string | null;
          }[];

          for (const item of parsed) {
            if (item.name && item.level) {
              allExtracted.push({
                name: item.name,
                level: item.level,
                validTo: item.validTo ?? null,
                confidence: "high"
              });
            }
          }
        }
      } catch (err) {
        console.warn(
          `Failed to analyze ${file.originalname}: ${String(err)}`
        );
      }
    }

    // Dedup by name
    const seen = new Set<string>();
    const unique = allExtracted.filter((q) => {
      const key = `${q.name}|${q.level}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    res.json({
      extracted: unique,
      totalFiles: files.length,
      analyzedFiles: files.filter(
        (f) => f.mimetype?.startsWith("image/") || f.mimetype === "application/pdf"
      ).length
    });
  }
);

/** Confirm and save extracted qualifications. */
uploadRouter.post(
  "/company/qualifications/confirm",
  async (req, res) => {
    const { qualifications } = req.body as {
      qualifications: { name: string; level: string; validTo?: string }[];
    };

    if (!Array.isArray(qualifications)) {
      return res.status(400).json({ error: "请提供 qualifications 数组" });
    }

    const saved: { id: number; name: string; level: string }[] = [];
    for (const q of qualifications) {
      if (!q.name || !q.level) continue;
      const result = await addQualification(q);
      saved.push({ id: result.id, name: result.name, level: result.level });
    }

    res.status(201).json({ saved, count: saved.length });
  }
);
