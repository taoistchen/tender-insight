import { describe, expect, it } from "vitest";
import { analyzeTender } from "../analyze-tender.js";
import { seedCompanyProfile } from "../../seed/company-profile.js";
import type { TenderNotice } from "../../domain/types.js";

const baseTender: TenderNotice = {
  city: "南京",
  title: "某办公楼装修改造工程施工招标公告",
  contentText:
    "投标人须具备建筑装修装饰工程专业承包二级及以上资质。合同估算价：300万元。投标截止时间：2026年07月15日 09:30。",
  budgetAmount: 3_000_000,
  deadlineTime: new Date("2026-07-15T09:30:00+08:00"),
  qualificationRequirements: [
    {
      name: "建筑装修装饰工程专业承包",
      level: "二级"
    }
  ]
};

describe("analyzeTender", () => {
  it("recommends a matching tender with traceable reasons", () => {
    const result = analyzeTender(baseTender, seedCompanyProfile, {
      now: new Date("2026-07-01T08:00:00+08:00")
    });

    expect(result.decision).toBe("recommended");
    expect(result.matchScore).toBeGreaterThanOrEqual(85);
    expect(result.matchedPoints).toContain("地区在公司可投范围内：南京");
    expect(result.matchedPoints).toContain(
      "资质满足：建筑装修装饰工程专业承包 二级 >= 二级"
    );
  });

  it("rejects tenders containing excluded service keywords", () => {
    const result = analyzeTender(
      {
        ...baseTender,
        title: "某办公楼装修改造工程监理招标公告"
      },
      seedCompanyProfile,
      { now: new Date("2026-07-01T08:00:00+08:00") }
    );

    expect(result.decision).toBe("rejected");
    expect(result.riskPoints).toContain("包含排除关键词：监理");
  });

  it("rejects missing required qualifications", () => {
    const result = analyzeTender(
      {
        ...baseTender,
        qualificationRequirements: [
          {
            name: "市政公用工程施工总承包",
            level: "三级"
          }
        ]
      },
      seedCompanyProfile,
      { now: new Date("2026-07-01T08:00:00+08:00") }
    );

    expect(result.decision).toBe("rejected");
    expect(result.riskPoints).toContain("缺少要求资质：市政公用工程施工总承包 三级");
  });

  it("marks low confidence matches for manual review", () => {
    const result = analyzeTender(
      {
        ...baseTender,
        title: "某综合楼工程施工招标公告",
        qualificationRequirements: []
      },
      seedCompanyProfile,
      { now: new Date("2026-07-13T08:00:00+08:00") }
    );

    expect(result.decision).toBe("manual_review");
    expect(result.manualReviewRequired).toBe(true);
  });
});
