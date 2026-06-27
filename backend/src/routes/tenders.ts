import { Router } from "express";
import { analyzeTender } from "../analysis/analyze-tender.js";
import type { TenderNotice } from "../domain/types.js";
import { seedCompanyProfile } from "../seed/company-profile.js";

export const tendersRouter = Router();

const SAMPLE_TENDERS: TenderNotice[] = [
  {
    city: "南京",
    url: "http://njggzy.nanjing.gov.cn/njweb/fjsz/buildService1.html",
    title: "某办公楼装修改造工程施工招标公告",
    contentText:
      "投标人须具备建筑装修装饰工程专业承包二级及以上资质。合同估算价：300万元。投标截止时间：2026年07月15日 09:30。",
    budgetAmount: 3_000_000,
    deadlineTime: new Date("2026-07-15T09:30:00+08:00"),
    qualificationRequirements: [
      { name: "建筑装修装饰工程专业承包", level: "二级" }
    ],
    personnelRequirements: [
      "项目负责人：建筑工程专业 二级建造师及以上"
    ],
    performanceRequirements: []
  },
  {
    city: "南京",
    url: "http://njggzy.nanjing.gov.cn/njweb/fjsz/buildService1.html",
    title: "某综合楼消防设施改造工程施工",
    contentText:
      "投标人须具备消防设施工程专业承包二级及以上资质。最高投标限价：518.6万元。投标截止时间：2026年07月18日 10:00。",
    budgetAmount: 5_186_000,
    deadlineTime: new Date("2026-07-18T10:00:00+08:00"),
    qualificationRequirements: [
      { name: "消防设施工程专业承包", level: "二级" }
    ],
    personnelRequirements: [],
    performanceRequirements: []
  },
  {
    city: "南京",
    url: "http://njggzy.nanjing.gov.cn/njweb/fjsz/buildService1.html",
    title: "某片区雨污分流及道路改造工程",
    contentText:
      "投标人须具备市政公用工程施工总承包三级及以上资质。预算金额：1200万元。投标截止时间：2026年07月12日 09:00。",
    budgetAmount: 12_000_000,
    deadlineTime: new Date("2026-07-12T09:00:00+08:00"),
    qualificationRequirements: [
      { name: "市政公用工程施工总承包", level: "三级" }
    ],
    personnelRequirements: [
      "项目负责人：市政公用工程专业 二级建造师及以上"
    ],
    performanceRequirements: [
      "近三年承担过单项合同金额500万元以上的市政道路工程"
    ]
  },
  {
    city: "南京",
    url: "http://njggzy.nanjing.gov.cn/njweb/fjsz/buildService1.html",
    title: "某市政道路工程监理招标公告",
    contentText:
      "投标人须具备市政公用工程监理乙级及以上资质。预算金额：未披露。投标截止时间：2026年07月10日 09:00。",
    budgetAmount: undefined,
    deadlineTime: new Date("2026-07-10T09:00:00+08:00"),
    qualificationRequirements: [
      { name: "市政公用工程监理", level: "乙级" }
    ],
    personnelRequirements: [],
    performanceRequirements: []
  }
];

tendersRouter.get("/tenders", (_request, response) => {
  const results = SAMPLE_TENDERS.map((tender) => ({
    city: tender.city,
    url: tender.url,
    title: tender.title,
    budgetAmount: tender.budgetAmount,
    deadlineTime: tender.deadlineTime,
    qualificationRequirements: tender.qualificationRequirements,
    personnelRequirements: tender.personnelRequirements,
    performanceRequirements: tender.performanceRequirements,
    analysis: analyzeTender(tender, seedCompanyProfile)
  }));

  response.json(results);
});
