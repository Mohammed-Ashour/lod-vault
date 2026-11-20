// Flow for study/p2-lexicon: the backup option for dictionary details.
import { lexiconSeed, entrySeed } from "./fixtures.mjs";

const seed = {
  local: {
    "lodVault.entries": entrySeed(),
    ...lexiconSeed()
  }
};

// Shows the downloaded backup on the page instead of saving a file.
const SHOW_DOWNLOAD = `(() => {
  LodVaultStore.downloadTextFile = (name, text) => {
    const data = JSON.parse(text);
    const box = document.createElement("pre");
    box.id = "download-view";
    box.style.cssText = "position:fixed;left:8px;right:8px;bottom:8px;max-height:34%;overflow:hidden;margin:0;padding:10px;font:11px/1.35 ui-monospace,monospace;background:#0b1220;color:#cfe3ff;border:1px solid #2f6fb0;border-radius:8px;z-index:99;white-space:pre-wrap";
    const lexicon = data.lexicon ? Object.keys(data.lexicon) : [];
    const haus = data.lexicon?.HAUS1;
    box.textContent = name + "\\n" + (lexicon.length
      ? "lexicon: " + lexicon.length + " words (" + lexicon.join(", ") + ")\\n\\nlexicon.HAUS1 = " + JSON.stringify({ lemma: haus.lemma, gender: haus.gender, noun: haus.noun, senses: haus.senses.length, sense1: { n: haus.senses[0].n, tr: { en: haus.senses[0].tr.en }, ex: haus.senses[0].ex[0].t, h: haus.senses[0].ex[0].h } })
      : "no lexicon field (" + data.entries.length + " entries, flashcardMeta)");
    document.getElementById("download-view")?.remove();
    document.body.append(box);
  };
})()`;

async function openData(page) {
  await page.click("#stats-tab");
  await page.wait(300);
  await page.eval(`document.getElementById("data-settings").open = true`);
  await page.wait(300);
  await page.eval(`document.getElementById("export-json").scrollIntoView({ block: "start" })`);
  await page.wait(300);
}

export default [
  {
    name: "lexicon-backup-dark",
    url: "/pages/popup.html",
    width: 420, height: 680, scale: 2, theme: "dark", seed,
    async run(page) {
      await openData(page);
      await page.shot("backup-option-dark.png", ".tools-row + .backup-options-row");
      await page.shot("data-settings-dark.png", "#data-settings");
    }
  },
  {
    name: "lexicon-backup-light",
    url: "/pages/popup.html",
    width: 420, height: 680, scale: 2, theme: "light", seed,
    async run(page) {
      await openData(page);
      await page.shot("data-settings-light.png", "#data-settings");
    }
  },
  {
    name: "lexicon-backup-gif",
    url: "/pages/popup.html",
    width: 420, height: 680, theme: "dark", seed,
    async run(page) {
      await page.eval(SHOW_DOWNLOAD);
      await page.gif("backup-with-lexicon.gif", async ({ hold }) => {
        await hold(600);
        await openData(page);
        await hold(500);
        await page.click("#export-json");
        await hold(1800);
        await page.click("#export-include-lexicon");
        await hold(700);
        await page.click("#export-json");
        await hold(3200);
      }, { width: 420 });
    }
  }
];
