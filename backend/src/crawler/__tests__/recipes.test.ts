import { describe, expect, it } from "vitest";
import {
  getCrawlerRecipe,
  getCrawlerRecipes,
  resolveRecipeSource,
  validateSiteRecipe
} from "../recipes.js";

describe("crawler recipes", () => {
  it("exposes the Huaian construction source with remote browser fallback", () => {
    const recipe = getCrawlerRecipe("huaian");

    expect(recipe.siteKey).toBe("huaian");
    expect(recipe.sources[0].key).toBe("construction");
    expect(recipe.sources[0].strategies).toEqual([
      "backend_fetch",
      "remote_browser"
    ]);
  });

  it("resolves a source and caps the requested pages", () => {
    const { source, maxPages } = resolveRecipeSource({
      siteKey: "huaian",
      sourceKey: "construction",
      requestedMaxPages: 50
    });

    expect(source.key).toBe("construction");
    expect(maxPages).toBe(5);
  });

  it("rejects actions without a selector where one is required", () => {
    expect(() =>
      validateSiteRecipe({
        siteKey: "bad",
        siteName: "Bad",
        city: "Bad",
        enabled: true,
        sources: [
          {
            key: "broken",
            name: "Broken",
            url: "https://example.com",
            maxPages: 1,
            strategies: ["remote_browser"],
            actions: [{ type: "waitForSelector" }],
            selectors: {
              items: ".item",
              title: "a",
              detailUrl: "a@href"
            }
          }
        ]
      })
    ).toThrow();
  });

  it("returns all enabled recipes for API responses", () => {
    const recipes = getCrawlerRecipes();

    expect(recipes.some((recipe) => recipe.siteKey === "huaian")).toBe(true);
    expect(recipes.every((recipe) => recipe.enabled)).toBe(true);
  });
});
