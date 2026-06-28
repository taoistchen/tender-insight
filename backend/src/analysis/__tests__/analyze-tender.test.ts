import { describe, expect, it } from "vitest";
import { analyzeTender } from "../analyze-tender.js";
import type { CompanyProfile, TenderNotice } from "../../domain/types.js";

const company: CompanyProfile = {
  companyName: "Demo Construction",
  preferredRegions: ["Nanjing"],
  preferredProjectTypes: ["renovation", "construction"],
  excludedKeywords: ["design", "supervision"],
  maxProjectAmount: 10_000_000,
  minProjectAmount: 0,
  minRemainingDays: 3,
  qualifications: [{ name: "Building Construction", level: "Class 2" }],
  personnel: [
    {
      personName: "Alice",
      certificateType: "constructor",
      major: "civil",
      level: "Class 2"
    }
  ],
  performances: [
    {
      projectName: "hospital renovation project",
      projectType: "renovation",
      amount: 3_000_000,
      completionDate: new Date("2025-12-31T00:00:00+08:00")
    }
  ]
};

const baseTender: TenderNotice = {
  city: "Nanjing",
  sourceSite: "南京市公共资源交易平台",
  url: "https://example.com/tender/1",
  title: "Hospital renovation construction tender",
  contentText: "Construction tender",
  budgetAmount: 2_000_000,
  deadlineTime: new Date("2026-07-15T09:30:00+08:00"),
  qualificationRequirements: [
    { name: "Building Construction", level: "Class 2" }
  ]
};

const now = new Date("2026-07-01T08:00:00+08:00");

describe("analyzeTender", () => {
  it("recommends a tender that matches region, type, qualification, budget and deadline", () => {
    const result = analyzeTender(baseTender, company, { now });

    expect(result.decision).toBe("recommended");
    expect(result.matchScore).toBeGreaterThanOrEqual(85);
    expect(result.matchedPoints).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Region matched"),
        expect.stringContaining("Qualification matched")
      ])
    );
  });

  it("rejects tenders containing excluded service keywords in the title", () => {
    const result = analyzeTender(
      { ...baseTender, title: "Hospital renovation design tender" },
      company,
      { now }
    );

    expect(result.decision).toBe("rejected");
    expect(result.riskPoints[0]).toContain("Excluded keyword");
  });

  it("rejects missing required qualifications", () => {
    const result = analyzeTender(
      {
        ...baseTender,
        qualificationRequirements: [
          { name: "Municipal Construction", level: "Class 3" }
        ]
      },
      company,
      { now }
    );

    expect(result.decision).toBe("rejected");
    expect(result.riskPoints[0]).toContain("Missing required qualification");
  });

  it("rejects when city is outside preferred regions", () => {
    const result = analyzeTender({ ...baseTender, city: "Beijing" }, company, {
      now
    });

    expect(result.decision).toBe("rejected");
    expect(result.riskPoints[0]).toContain("City not preferred");
  });

  it("rejects when deadline has passed", () => {
    const result = analyzeTender(baseTender, company, {
      now: new Date("2026-07-20T08:00:00+08:00")
    });

    expect(result.decision).toBe("rejected");
    expect(result.riskPoints[0]).toContain("Deadline has passed");
  });

  it("rejects when budget exceeds company max amount", () => {
    const result = analyzeTender(
      { ...baseTender, budgetAmount: 50_000_000 },
      company,
      { now }
    );

    expect(result.decision).toBe("rejected");
    expect(result.riskPoints[0]).toContain("Project budget exceeds");
  });

  it("flags unclear qualifications as risk but still recommends when score is high", () => {
    const result = analyzeTender(
      { ...baseTender, qualificationRequirements: [] },
      company,
      { now }
    );

    // High score (85) with non-critical risk → recommended
    expect(result.decision).toBe("recommended");
    expect(result.riskPoints).toContain("Qualification requirements are unclear");
  });

  it("marks low confidence matches for manual review", () => {
    const result = analyzeTender(
      {
        ...baseTender,
        title: "Drainage pipe tender",
        contentText: "General works",
        budgetAmount: undefined,
        qualificationRequirements: []
      },
      company,
      { now: new Date("2026-07-13T08:00:00+08:00") }
    );

    expect(result.decision).toBe("manual_review");
    expect(result.manualReviewRequired).toBe(true);
  });

  it("matches qualifications with word-order variations", () => {
    const result = analyzeTender(
      {
        ...baseTender,
        qualificationRequirements: [
          { name: "Construction Building", level: "Class 2" }
        ]
      },
      company,
      { now }
    );

    expect(result.decision).toBe("recommended");
  });

  it("matches personnel and performance requirements against company records", () => {
    const result = analyzeTender(
      {
        ...baseTender,
        personnelRequirements: [
          "Project manager must have civil Class 2 constructor certificate"
        ],
        performanceRequirements: [
          "Requires similar hospital renovation project experience"
        ]
      },
      company,
      { now }
    );

    expect(result.decision).toBe("recommended");
    expect(result.riskPoints.join("\n")).not.toContain("待实现");
    expect(result.matchedPoints).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Personnel requirement matched"),
        expect.stringContaining("Performance requirement matched")
      ])
    );
  });

  it("keeps unmatched personnel and performance requirements in risk points", () => {
    const result = analyzeTender(
      {
        ...baseTender,
        personnelRequirements: [
          "Project manager must have mechanical Class 1 constructor certificate"
        ],
        performanceRequirements: [
          "Requires similar bridge construction project experience"
        ]
      },
      company,
      { now }
    );

    expect(result.decision).toBe("manual_review");
    expect(result.riskPoints).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Personnel requirement not matched"),
        expect.stringContaining("Performance requirement not matched")
      ])
    );
  });
});
