import { describe, expect, it } from "vitest";
import { compareQualificationLevel, levelSatisfies } from "../qualification-level.js";

describe("qualification level comparison", () => {
  it("treats second class as satisfying third class and above", () => {
    expect(levelSatisfies("二级", "三级")).toBe(true);
    expect(levelSatisfies("贰级", "三级")).toBe(true);
  });

  it("does not treat third class as satisfying second class", () => {
    expect(levelSatisfies("三级", "二级")).toBe(false);
  });

  it("orders special class above first, second, and third class", () => {
    expect(compareQualificationLevel("特级", "一级")).toBeGreaterThan(0);
    expect(compareQualificationLevel("一级", "二级")).toBeGreaterThan(0);
    expect(compareQualificationLevel("二级", "三级")).toBeGreaterThan(0);
  });

  it("treats ungraded qualifications as only matching ungraded requirements", () => {
    expect(levelSatisfies("不分等级", "不分等级")).toBe(true);
    expect(levelSatisfies("不分等级", "三级")).toBe(false);
  });
});
