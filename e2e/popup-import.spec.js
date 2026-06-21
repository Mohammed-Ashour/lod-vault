const path = require("node:path");
const { test, expect, EXPORT_FIXTURE } = require("./helpers");

// Popup + JSON import e2e. This is the flow that broke twice in Firefox:
//   1. the popup's file picker unloaded the toolbar popup (Firefox quirk), and
//   2. the restore page read the wrong global (LodWrapperStore vs LodVaultStore).
// Both slipped through unit tests, so this e2e guards them directly.
//
// Flow: open the popup page → click "Restore JSON" → the import page opens in a
// new tab → set the file input to the fixture export → expect "Imported N words"
// → reopen the popup and assert the saved list reflects the import.

test.describe("popup + Restore JSON", () => {
  test("popup renders the saved-words header", async ({ context, extensionBaseUrl }) => {
    const popup = await context.newPage();
    await popup.goto(`${extensionBaseUrl}/pages/popup.html`);
    await expect(popup.locator("h1")).toHaveText("Saved words");
    await popup.close();
  });

  test("Restore JSON imports words via the import tab", async ({ context, extensionBaseUrl }) => {
    test.setTimeout(60000);

    // 1. Open the popup and click "Restore JSON".
    const popup = await context.newPage();
    await popup.goto(`${extensionBaseUrl}/pages/popup.html`);
    await expect(popup.locator("#import-json")).toHaveText("Restore JSON");

    // Clicking opens pages/import.html in a new tab. We drove the popup page
    // directly (not the toolbar button), so it stays open across the click.
    const newTabPromise = context.waitForEvent("page", { timeout: 15000 });
    await popup.locator("#import-json").click();

    const importTab = await newTabPromise;
    await importTab.bringToFront();
    await expect(importTab.locator("h1")).toHaveText("Restore JSON backup");

    // 2. Set the file input to the fixture export (no native picker involved,
    //    so the tab stays alive in both browsers).
    const fileInput = importTab.locator("#file-input");
    await fileInput.setInputFiles(EXPORT_FIXTURE);

    // 3. Expect the success status. The fixture export has 3 entries.
    const status = importTab.locator("#status");
    await expect(status).toContainText("Imported 3 words", { timeout: 20000 });

    // 4. Reopen the popup and confirm the saved list shows the imported words.
    const popup2 = await context.newPage();
    await popup2.goto(`${extensionBaseUrl}/pages/popup.html`);
    const savedList = popup2.locator("#saved-list");
    await expect(savedList).toContainText("Haus", { timeout: 15000 });
    await expect(savedList).toContainText("Buch");
    await popup2.close();
    await importTab.close();
  });
});
