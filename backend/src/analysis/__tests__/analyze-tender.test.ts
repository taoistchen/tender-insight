import { describe, expect, it } from "vitest";
import { analyzeTender } from "../analyze-tender.js";
import { seedCompanyProfile } from "../../seed/company-profile.js";
import type { TenderNotice } from "../../domain/types.js";

const baseTender: TenderNotice = {
  city: "南京",
  url: "https://njggzy.nanjing.gov.cn/njweb/jyxx/071001/20260701/xxxx.html",
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
  describe("recommended", () => {
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
  });

  describe("rejected", () => {
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

    it("rejects when city is outside preferred regions", () => {
      const result = analyzeTender(
        { ...baseTender, city: "北京" },
        seedCompanyProfile,
        { now: new Date("2026-07-01T08:00:00+08:00") }
      );

      expect(result.decision).toBe("rejected");
      expect(result.riskPoints).toContain("地区不在公司可投范围内：北京");
    });

    it("rejects when deadline has passed", () => {
      const result = analyzeTender(
        baseTender,
        seedCompanyProfile,
        { now: new Date("2026-07-20T08:00:00+08:00") }
      );

      expect(result.decision).toBe("rejected");
      expect(result.riskPoints).toContain("投标截止时间已过");
    });

    it("rejects when budget exceeds company max amount", () => {
      const result = analyzeTender(
        { ...baseTender, budgetAmount: 50_000_000 },
        seedCompanyProfile,
        { now: new Date("2026-07-01T08:00:00+08:00") }
      );

      expect(result.decision).toBe("rejected");
      expect(result.riskPoints).toContain("项目金额超过公司最大承接范围");
    });
  });

  describe("watch", () => {
    it("returns manual review for score 70-84 when risk points require human verification", () => {
      // Tender with no explicit qualification requirements (triggers risk point)
      // but otherwise matching — should still require human review.
      const result = analyzeTender(
        {
          ...baseTender,
          title: "某综合楼工程施工招标公告",
          qualificationRequirements: [],
          budgetAmount: 5_000_000
        },
        seedCompanyProfile,
        { now: new Date("2026-07-01T08:00:00+08:00") }
      );

      // Score breakdown: region 10 + type 15? + qual (no req→passed+10) + personnel 20 + perf 15 + amount 10 = 80
      // With risk point for 资质要求未明确
      expect(result.decision).toBe("manual_review");
      expect(result.manualReviewRequired).toBe(true);
      expect(result.matchScore).toBeGreaterThanOrEqual(70);
    });
  });

  describe("manual review", () => {
    it("marks low confidence matches for manual review", () => {
      // Score breakdown for this case (to hit 50-69):
      //   region 10 + qual-absent 10 + personnel 20 + perf 15 = 55
      //   No type match because title and contentText avoid preferred types.
      //   deadline is tight (2 days) but that only adds risk point, not score.
      const result = analyzeTender(
        {
          city: "南京",
          url: "https://njggzy.nanjing.gov.cn/njweb/jyxx/071001/20260703/wwww.html",
          title: "某综合楼排水管道工程施工招标公告",
          contentText:
            "本项目采用资格后审方式。投标截止时间：2026年07月15日 09:30。",
          budgetAmount: undefined,
          deadlineTime: new Date("2026-07-15T09:30:00+08:00"),
          qualificationRequirements: []
        },
        seedCompanyProfile,
        { now: new Date("2026-07-13T08:00:00+08:00") }
      );

      expect(result.decision).toBe("manual_review");
      expect(result.manualReviewRequired).toBe(true);
    });
  });

  describe("fuzzy qualification name matching", () => {
    it("matches qualifications with word-order variations", () => {
      // "建筑装饰装修工程" vs company's "建筑装修装饰工程"
      const result = analyzeTender(
        {
          ...baseTender,
          qualificationRequirements: [
            { name: "建筑装饰装修工程专业承包", level: "二级" }
          ]
        },
        seedCompanyProfile,
        { now: new Date("2026-07-01T08:00:00+08:00") }
      );

      expect(result.decision).toBe("recommended");
    });

    it("does not match completely unrelated qualifications", () => {
      const result = analyzeTender(
        {
          ...baseTender,
          qualificationRequirements: [
            { name: "市政公用工程施工总承包", level: "三级" }
          ]
        },
        seedCompanyProfile,
        { now: new Date("2026-07-01T08:00:00+08:00") }
      );

      expect(result.decision).toBe("rejected");
    });
  });

  describe("personnel requirements in tender", () => {
    it("flags personnel requirements for manual review when present", () => {
      const result = analyzeTender(
        {
          ...baseTender,
          personnelRequirements: [
            "项目负责人：市政公用工程专业 二级建造师及以上"
          ]
        },
        seedCompanyProfile,
        { now: new Date("2026-07-01T08:00:00+08:00") }
      );

      expect(result.riskPoints.some(p => p.includes("人员匹配功能待实现"))).toBe(true);
      expect(result.decision).toBe("manual_review");
      expect(result.manualReviewRequired).toBe(true);
    });
  });
});
