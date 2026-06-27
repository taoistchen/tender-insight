import { Router } from "express";
import { seedCompanyProfile } from "../seed/company-profile.js";

export const companyRouter = Router();

companyRouter.get("/company/profile", (_request, response) => {
  response.json(seedCompanyProfile);
});
