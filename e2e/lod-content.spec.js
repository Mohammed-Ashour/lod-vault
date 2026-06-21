const { test, expect, routeLodArticle } = require("./helpers");

// Content-script e2e: navigating to a lod.lu article URL (fulfilled with a
// fixture page via page.route) must inject the LODVault banner showing the
// extracted word. Runs for both Chrome and Firefox (see playwright.config.js).

test.describe("LOD content script on lod.lu", () => {
  test("renders the banner with the article word", async ({ context, browser }) => {
    const page = await context.newPage();
    await routeLodArticle(page);

    await page.goto("https://lod.lu/artikel/HAUS1?lemma=Haus");

    // The content script injects #lodvault-banner and populates .lodw-word
    // with the extracted heading.
    const banner = page.locator("#lodvault-banner");
    await expect(banner).toBeVisible({ timeout: 15000 });
    await expect(banner.locator(".lodw-word")).toHaveText("Haus");
    // .lodw-info shows POS · English translation.
    await expect(banner.locator(".lodw-info")).toContainText("house");
  });

  test("does not inject the banner on a non-lod.lu page", async ({ context }) => {
    const page = await context.newPage();
    await page.goto("https://example.com/");
    // Only the lightweight selection trigger runs on non-lod pages; the banner
    // must not be present.
    await expect(page.locator("#lodvault-banner")).toHaveCount(0);
    await page.close();
  });
});
