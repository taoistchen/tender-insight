import { z } from "zod";
import type { CrawlStrategy } from "./types.js";

const selectorSchema = z.string().min(1);
const timeoutMsSchema = z.number().int().positive().max(60000).optional();

export const crawlStrategySchema = z.enum(["backend_fetch", "remote_browser"]);

export const crawlActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("goto"),
    urlFrom: z.literal("source.url")
  }),
  z.object({
    type: z.literal("waitForSelector"),
    selector: selectorSchema,
    timeoutMs: timeoutMsSchema
  }),
  z.object({
    type: z.literal("click"),
    selector: selectorSchema,
    timeoutMs: timeoutMsSchema
  }),
  z.object({
    type: z.literal("scrollToBottom"),
    times: z.number().int().min(1).max(10).default(1)
  }),
  z.object({
    type: z.literal("extractHtml"),
    selector: selectorSchema
  })
]);
export type CrawlAction = z.infer<typeof crawlActionSchema>;

export const crawlSelectorsSchema = z.object({
  items: selectorSchema,
  title: selectorSchema,
  detailUrl: selectorSchema,
  publishDate: selectorSchema.optional()
});
export type CrawlSelectors = z.infer<typeof crawlSelectorsSchema>;

export const crawlSourceSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url(),
  maxPages: z.number().int().positive(),
  strategies: z.array(crawlStrategySchema).min(1),
  actions: z.array(crawlActionSchema).min(1),
  selectors: crawlSelectorsSchema
});
export type CrawlSource = z.infer<typeof crawlSourceSchema>;

export const siteRecipeSchema = z.object({
  siteKey: z.string().min(1),
  siteName: z.string().min(1),
  city: z.string().min(1),
  enabled: z.boolean(),
  sources: z.array(crawlSourceSchema).min(1)
});
export type SiteRecipe = z.infer<typeof siteRecipeSchema>;

const recipeDefinitions = [
  {
    siteKey: "huaian",
    siteName: "Huai'an Public Resources Trading Center",
    city: "Huaian",
    enabled: true,
    sources: [
      {
        key: "construction",
        name: "Construction Projects",
        url: "https://ggzy.huaian.gov.cn/",
        maxPages: 5,
        strategies: ["backend_fetch", "remote_browser"],
        actions: [
          { type: "goto", urlFrom: "source.url" },
          { type: "waitForSelector", selector: "body" },
          { type: "extractHtml", selector: "body" }
        ],
        selectors: {
          items: ".ewb-list-node",
          title: "a",
          detailUrl: "a@href",
          publishDate: ".ewb-list-date"
        }
      }
    ]
  }
];

export function validateSiteRecipe(input: unknown): SiteRecipe {
  return siteRecipeSchema.parse(input);
}

export function getCrawlerRecipes(): SiteRecipe[] {
  return recipeDefinitions
    .map((recipe) => validateSiteRecipe(recipe))
    .filter((recipe) => recipe.enabled);
}

export function getCrawlerRecipe(siteKey: string): SiteRecipe {
  const recipe = getCrawlerRecipes().find((item) => item.siteKey === siteKey);

  if (!recipe) {
    throw new Error(`Unknown crawler recipe: ${siteKey}`);
  }

  return recipe;
}

export function resolveRecipeSource({
  siteKey,
  sourceKey,
  requestedMaxPages
}: {
  siteKey: string;
  sourceKey: string;
  requestedMaxPages?: number;
}): { recipe: SiteRecipe; source: CrawlSource; maxPages: number } {
  const recipe = getCrawlerRecipe(siteKey);
  const source = recipe.sources.find((item) => item.key === sourceKey);

  if (!source) {
    throw new Error(`Unknown crawler source: ${siteKey}/${sourceKey}`);
  }

  const requestedPages =
    requestedMaxPages === undefined ? source.maxPages : requestedMaxPages;
  const maxPages = Math.max(1, Math.min(requestedPages, source.maxPages, 10));

  return { recipe, source, maxPages };
}
