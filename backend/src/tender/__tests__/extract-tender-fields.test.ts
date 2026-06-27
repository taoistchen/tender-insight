import { describe, expect, it } from "vitest";
import { extractTenderFields } from "../extract-tender-fields.js";

describe("extractTenderFields", () => {
  describe("budget amount", () => {
    it("extracts budget amount in yuan from Chinese ten-thousand-yuan text", () => {
      const result = extractTenderFields("本项目合同估算价：518.6万元，工期90日历天。");

      expect(result.budgetAmount).toBe(5_186_000);
    });

    it("extracts from 预算金额 pattern", () => {
      const result = extractTenderFields("预算金额：2000万元");

      expect(result.budgetAmount).toBe(20_000_000);
    });

    it("extracts from 最高投标限价 pattern", () => {
      const result = extractTenderFields("最高投标限价：850.5万元");

      expect(result.budgetAmount).toBe(8_505_000);
    });

    it("returns undefined when no amount pattern matches", () => {
      const result = extractTenderFields("本项目资金来源已落实。");

      expect(result.budgetAmount).toBeUndefined();
    });
  });

  describe("deadline", () => {
    it("extracts tender deadline from common wording", () => {
      const result = extractTenderFields("投标截止时间：2026年07月15日 09:30。");

      expect(result.deadlineTime).toEqual(new Date("2026-07-15T09:30:00+08:00"));
    });

    it("extracts deadline in slash format", () => {
      const result = extractTenderFields("投标截止时间：2026/07/15 09:30。");

      expect(result.deadlineTime).toEqual(new Date("2026-07-15T09:30:00+08:00"));
    });

    it("extracts deadline in dash format", () => {
      const result = extractTenderFields("递交截止时间：2026-07-15 09:30。");

      expect(result.deadlineTime).toEqual(new Date("2026-07-15T09:30:00+08:00"));
    });

    it("extracts deadline with 时/分 notation", () => {
      const result = extractTenderFields("投标截止时间：2026年7月15日9时30分。");

      expect(result.deadlineTime).toEqual(new Date("2026-07-15T09:30:00+08:00"));
    });

    it("handles non-zero-padded month and day", () => {
      const result = extractTenderFields("投标截止时间：2026年7月8日 09:30。");

      expect(result.deadlineTime).toEqual(new Date("2026-07-08T09:30:00+08:00"));
    });

    it("returns undefined when no deadline pattern matches", () => {
      const result = extractTenderFields("请各投标人按时递交投标文件。");

      expect(result.deadlineTime).toBeUndefined();
    });
  });

  describe("qualification requirements", () => {
    it("extracts qualification requirements with 及以上 suffix", () => {
      const result = extractTenderFields(
        "投标人须具备建筑工程施工总承包三级及以上资质，并具有有效安全生产许可证。"
      );

      expect(result.qualificationRequirements).toEqual([
        { name: "建筑工程施工总承包", level: "三级" }
      ]);
    });

    it("extracts qualification requirements without 及以上 suffix", () => {
      const result = extractTenderFields(
        "投标人须具备市政公用工程施工总承包二级资质。"
      );

      expect(result.qualificationRequirements).toEqual([
        { name: "市政公用工程施工总承包", level: "二级" }
      ]);
    });

    it("extracts with 或以上 variant", () => {
      const result = extractTenderFields(
        "须具备消防设施工程专业承包二级或以上资质。"
      );

      expect(result.qualificationRequirements).toEqual([
        { name: "消防设施工程专业承包", level: "二级" }
      ]);
    });

    it("extracts multiple qualification requirements", () => {
      const result = extractTenderFields(
        "投标人须具备建筑工程施工总承包三级及以上资质，"
        + "并具备消防设施工程专业承包二级及以上资质。"
      );

      expect(result.qualificationRequirements).toHaveLength(2);
      expect(result.qualificationRequirements[0]).toEqual({
        name: "建筑工程施工总承包",
        level: "三级"
      });
      expect(result.qualificationRequirements[1]).toEqual({
        name: "消防设施工程专业承包",
        level: "二级"
      });
    });

    it("handles ungraded qualifications", () => {
      const result = extractTenderFields(
        "须具备特种工程（结构补强）专业承包不分等级资质。"
      );

      expect(result.qualificationRequirements).toEqual([
        { name: "特种工程（结构补强）专业承包", level: "不分等级" }
      ]);
    });

    it("returns empty array when no qualification pattern matches", () => {
      const result = extractTenderFields("本项目采用资格后审方式。");

      expect(result.qualificationRequirements).toEqual([]);
    });
  });

  describe("personnel requirements", () => {
    it("extracts project manager requirement with 建造师", () => {
      const result = extractTenderFields(
        "项目负责人须具备市政公用工程专业二级及以上注册建造师执业资格。"
      );

      expect(result.personnelRequirements).toContain(
        "项目负责人：市政公用工程专业 二级建造师及以上"
      );
    });

    it("returns empty when no personnel requirement found", () => {
      const result = extractTenderFields("本项目对项目负责人无特殊要求。");

      expect(result.personnelRequirements).toEqual([]);
    });
  });

  describe("performance requirements", () => {
    it("extracts performance requirement with 承担过", () => {
      const result = extractTenderFields(
        "企业近三年承担过单项合同金额500万元以上的市政道路工程。"
      );

      expect(result.performanceRequirements.length).toBeGreaterThan(0);
    });

    it("returns empty when no performance requirement found", () => {
      const result = extractTenderFields("本项目对业绩无要求。");

      expect(result.performanceRequirements).toEqual([]);
    });
  });
});
