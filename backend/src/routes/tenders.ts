import { Router } from "express";
import { analyzeTender } from "../analysis/analyze-tender.js";
import type { TenderNotice } from "../domain/types.js";
import { seedCompanyProfile } from "../seed/company-profile.js";

export const tendersRouter = Router();

const sampleTender: TenderNotice = {
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
  ],
  personnelRequirements: [
    "项目负责人：建筑工程专业 二级建造师及以上"
  ],
  performanceRequirements: []
};

tendersRouter.get("/tenders", (_request, response) => {
  response.json([
    {
      ...sampleTender,
      analysis: analyzeTender(sampleTender, seedCompanyProfile)
    }
  ]);
});
