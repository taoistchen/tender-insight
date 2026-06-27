import { Router } from "express";
import { seedCompanyProfile } from "../seed/company-profile.js";

export const companyRouter = Router();

companyRouter.get("/company/profile", (_request, response) => {
  response.json({
    companyName: seedCompanyProfile.companyName,
    preferredRegions: seedCompanyProfile.preferredRegions,
    preferredProjectTypes: seedCompanyProfile.preferredProjectTypes,
    excludedKeywords: seedCompanyProfile.excludedKeywords,
    maxProjectAmount: seedCompanyProfile.maxProjectAmount,
    minRemainingDays: seedCompanyProfile.minRemainingDays,
    qualifications: seedCompanyProfile.qualifications.map((q) => ({
      name: q.name,
      level: q.level,
      validTo: q.validTo
    }))
  });
});
