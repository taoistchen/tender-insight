/**
 * DeepSeek AI-powered tender-company match evaluation.
 *
 * Augments the deterministic rule-based scoring with semantic
 * understanding of qualification requirements, personnel fit,
 * and project type compatibility.
 */

import type { CompanyProfile, TenderNotice } from "../domain/types.js";
import { chat } from "../ai/config.js";

export interface AiScoreResult {
  score: number; // 0-100 AI evaluated match score
  matchedPoints: string[];
  riskPoints: string[];
}

/**
 * Use DeepSeek to evaluate how well a tender matches the company's profile.
 * Returns a score and supporting analysis points.
 */
export async function evaluateMatchWithAI(
  tender: TenderNotice,
  company: CompanyProfile
): Promise<AiScoreResult | null> {
  const companyInfo = formatCompanyProfile(company);
  const tenderInfo = formatTenderForAI(tender);

  const prompt = `你是一个专业的招标评估助手。请根据以下信息，评估这个招标项目是否适合该公司投标。

## 公司资质和能力
${companyInfo}

## 招标项目信息
${tenderInfo}

## 评分要求
请从以下维度评估匹配度（0-100分），并列出匹配点和风险点：

1. **区域匹配** (10分) - 项目所在城市是否在公司偏好区域
2. **项目类型匹配** (15分) - 项目类型是否匹配公司业务范围
3. **资质要求** (25分) - 公司是否具备招标要求的资质和等级
4. **人员要求** (20分) - 公司人员证书是否满足要求
5. **业绩匹配** (15分) - 公司是否有类似项目经验
6. **预算合理性** (10分) - 项目金额是否在公司承接能力范围内
7. **时间充裕度** (5分) - 投标截止时间是否充裕

请严格按照以下JSON格式返回（不要包含任何其他文字）：
{
  "score": 85,
  "matchedPoints": ["区域匹配：项目位于南京市，在公司偏好区域内", "资质匹配：公司具备建筑工程施工总承包二级资质，满足招标要求"],
  "riskPoints": ["预算偏高：项目预算2500万，公司最大项目金额2000万，略超出承接范围"]
}`;

  const result = await chat(
    [
      {
        role: "system",
        content:
          "你是一个专业的招标评估助手。严格只返回JSON，不要任何其他文字或markdown格式。"
      },
      { role: "user", content: prompt }
    ],
    { temperature: 0.2, max_tokens: 1024 }
  );

  if (!result) return null;

  try {
    // Strip markdown fences if present
    const jsonStr = result
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const parsed = JSON.parse(jsonStr) as {
      score?: number;
      matchedPoints?: string[];
      riskPoints?: string[];
    };

    if (typeof parsed.score !== "number") return null;

    return {
      score: Math.max(0, Math.min(100, Math.round(parsed.score))),
      matchedPoints: Array.isArray(parsed.matchedPoints)
        ? parsed.matchedPoints
        : [],
      riskPoints: Array.isArray(parsed.riskPoints) ? parsed.riskPoints : []
    };
  } catch {
    console.warn("AI score parse failed, raw result:", result.slice(0, 200));
    return null;
  }
}

function formatCompanyProfile(company: CompanyProfile): string {
  const lines: string[] = [];

  lines.push(`公司名称：${company.companyName}`);
  lines.push(
    `偏好区域：${company.preferredRegions.join("、") || "不限"}`
  );
  lines.push(
    `偏好项目类型：${company.preferredProjectTypes.join("、") || "不限"}`
  );
  lines.push(`最大项目金额：${company.maxProjectAmount.toLocaleString()}元`);
  lines.push(`最小项目金额：${company.minProjectAmount.toLocaleString()}元`);
  lines.push(`最少剩余天数：${company.minRemainingDays}天`);

  if (company.qualifications.length > 0) {
    lines.push("=== 公司资质 ===");
    for (const q of company.qualifications) {
      let validTo = "";
      if (q.validTo) {
        try {
          const d = q.validTo instanceof Date ? q.validTo : new Date(q.validTo);
          if (!Number.isNaN(d.getTime())) {
            validTo = ` (有效期至${d.toISOString().slice(0, 10)})`;
          }
        } catch { /* ignore invalid date */ }
      }
      lines.push(`- ${q.name}：${q.level}${validTo}`);
    }
  }

  if (company.personnel && company.personnel.length > 0) {
    lines.push("=== 公司人员 ===");
    for (const p of company.personnel) {
      const parts: string[] = [p.personName];
      if (p.certificateType) parts.push(p.certificateType);
      if (p.major) parts.push(p.major);
      if (p.level) parts.push(p.level);
      lines.push(`- ${parts.join(" / ")}`);
    }
  }

  if (company.performances && company.performances.length > 0) {
    lines.push("=== 公司业绩 ===");
    for (const perf of company.performances) {
      const parts: string[] = [perf.projectName];
      if (perf.projectType) parts.push(`类型：${perf.projectType}`);
      if (perf.amount) parts.push(`金额：${perf.amount.toLocaleString()}元`);
      lines.push(`- ${parts.join(" | ")}`);
    }
  }

  return lines.join("\n");
}

function formatTenderForAI(tender: TenderNotice): string {
  const lines: string[] = [];

  lines.push(`项目名称：${tender.title}`);
  lines.push(`所在城市：${tender.city}`);
  lines.push(`来源站点：${tender.sourceSite}`);
  if (tender.budgetAmount) {
    lines.push(`预算金额：${tender.budgetAmount.toLocaleString()}元`);
  }
  if (tender.deadlineTime) {
    lines.push(
      `截止时间：${tender.deadlineTime.toISOString().slice(0, 16).replace("T", " ")}`
    );
  }

  if (tender.qualificationRequirements.length > 0) {
    lines.push("=== 资质要求 ===");
    for (const q of tender.qualificationRequirements) {
      lines.push(`- ${q.name}：${q.level}`);
    }
  }

  if (tender.personnelRequirements && tender.personnelRequirements.length > 0) {
    lines.push("=== 人员要求 ===");
    for (const p of tender.personnelRequirements) {
      lines.push(`- ${p}`);
    }
  }

  if (
    tender.performanceRequirements &&
    tender.performanceRequirements.length > 0
  ) {
    lines.push("=== 业绩要求 ===");
    for (const p of tender.performanceRequirements) {
      lines.push(`- ${p}`);
    }
  }

  lines.push("=== 招标内容摘要 ===");
  lines.push(tender.contentText.slice(0, 3000));

  return lines.join("\n");
}
