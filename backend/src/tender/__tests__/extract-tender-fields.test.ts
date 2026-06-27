import { describe, expect, it } from "vitest";
import { extractTenderFields } from "../extract-tender-fields.js";

describe("extractTenderFields", () => {
  it("extracts budget amount in yuan from Chinese ten-thousand-yuan text", () => {
    const result = extractTenderFields("本项目合同估算价：518.6万元，工期90日历天。");

    expect(result.budgetAmount).toBe(5_186_000);
  });

  it("extracts tender deadline from common wording", () => {
    const result = extractTenderFields("投标截止时间：2026年07月15日 09:30。");

    expect(result.deadlineTime).toEqual(new Date("2026-07-15T09:30:00+08:00"));
  });

  it("extracts qualification requirements from construction notice text", () => {
    const result = extractTenderFields(
      "投标人须具备建筑工程施工总承包三级及以上资质，并具有有效安全生产许可证。"
    );

    expect(result.qualificationRequirements).toEqual([
      {
        name: "建筑工程施工总承包",
        level: "三级"
      }
    ]);
  });
});
