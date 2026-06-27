import type { CompanyProfile } from "../domain/types.js";

export const seedCompanyProfile: CompanyProfile = {
  companyName: "江苏亚亿建设集团有限公司",
  preferredRegions: ["南京", "淮安", "镇江", "连云港"],
  preferredProjectTypes: ["建筑", "消防", "装修", "防水", "防腐", "保温", "结构补强", "改造"],
  excludedKeywords: ["监理", "设计", "勘察", "审计", "造价咨询"],
  maxProjectAmount: 20_000_000,
  minProjectAmount: 0,
  minRemainingDays: 5,
  qualifications: [
    {
      name: "建筑工程施工总承包",
      level: "二级",
      validTo: new Date("2030-03-12T00:00:00+08:00")
    },
    {
      name: "消防设施工程专业承包",
      level: "二级",
      validTo: new Date("2027-04-20T00:00:00+08:00")
    },
    {
      name: "防水防腐保温工程专业承包",
      level: "二级",
      validTo: new Date("2027-04-20T00:00:00+08:00")
    },
    {
      name: "建筑装修装饰工程专业承包",
      level: "二级",
      validTo: new Date("2027-04-20T00:00:00+08:00")
    },
    {
      name: "特种工程（结构补强）专业承包",
      level: "不分等级",
      validTo: new Date("2027-04-20T00:00:00+08:00")
    }
  ]
};
