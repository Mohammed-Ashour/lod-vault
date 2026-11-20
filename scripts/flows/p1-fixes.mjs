// Flows for the study/p1-fixes PR. Run once per ref:
//   node scripts/record-flow.mjs --scenario scripts/flows/p1-fixes.mjs --ref origin/main --out /tmp/p1/before
//   node scripts/record-flow.mjs --scenario scripts/flows/p1-fixes.mjs --ref study/p1-fixes --out /tmp/p1/after
import { seed } from "../screenshot-stub.mjs";

const bareSeed = structuredClone(seed);
bareSeed.local["lodVault.entries"].BARE1 = {
  id: "BARE1", word: "Dëppen", url: "https://lod.lu/artikel/DEPPEN1", pos: "n",
  translations: {}, favorite: true, study: true, createdAt: new Date().toISOString()
};
bareSeed.local["lodVault.flashcardSettings"] = { mode: "self" };

export default async ({ navigate, evaluate, click, press, shot, gif, sleep }) => {
  // A1: Reveal with the mouse, then rate with the keyboard.
  await navigate("flashcards.html", { width: 900, height: 760 });
  await gif("keyboard-after-mouse-reveal", async () => {
    await sleep(600);
    await click("#flip-card");
    await sleep(900);
    await press("2");
    await sleep(1200);
    await press("2");
    await sleep(1200);
  });

  // S8/S9: the stat line and daily progress.
  await navigate("flashcards.html", { width: 1100, height: 760 });
  await shot("today-progress", { selector: ".statline" });
  await click("#session-trigger");
  await sleep(1000);
  await shot("session-menu", { selector: "#session-menu" });

  // C3: reverse mode with a word that has no saved translation.
  await navigate("flashcards.html", { width: 900, height: 760, seed: bareSeed, query: "deck=favorites" });
  await evaluate(`(() => { const s = document.getElementById("order-mode"); s.value = "sequential"; s.dispatchEvent(new Event("change")); })()`);
  await sleep(200);
  await click("#direction-toggle");
  await sleep(300);
  for (let i = 0; i < 6; i += 1) {
    if (await evaluate(`document.getElementById("card-word").textContent === "Dëppen" || document.getElementById("card-hint").textContent.includes("No saved")`)) break;
    await click("#next-card");
    await sleep(200);
  }
  await sleep(900);
  await shot("reverse-without-translation", { selector: "#card-shell" });
};
