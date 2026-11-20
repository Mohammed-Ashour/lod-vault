// Flows for the study/p1-fsrs PR:
//   node scripts/record-flow.mjs --scenario scripts/flows/p1-fsrs.mjs --ref study/p1-fixes --out /tmp/p2/before
//   node scripts/record-flow.mjs --scenario scripts/flows/p1-fsrs.mjs --out /tmp/p2/after
export default async ({ navigate, evaluate, click, press, shot, gif, sleep }) => {
  const hasHard = await (async () => {
    await navigate("flashcards.html", { width: 900, height: 820 });
    return evaluate(`Boolean(document.getElementById("show-hard"))`);
  })();

  // A Today session: reveal, read the intervals on the buttons, grade.
  await gif("today-session-intervals", async () => {
    await sleep(500);
    await click("#flip-card");
    await sleep(1600);
    await click(hasHard ? '[data-grade="3"]' : '[data-rating="2"]');
    await sleep(900);
    await press(" ");
    await sleep(1600);
    await press("1");
    await sleep(900);
    await press(" ");
    await sleep(1600);
    await press("3");
    await sleep(1000);
  });

  for (const theme of ["dark", "light"]) {
    await navigate("flashcards.html", { width: 1000, height: 820, theme });
    await click("#flip-card");
    await sleep(1100);
    await shot(`rating-bar-${theme}`, { selector: "#card-shell" });
  }

  if (hasHard) {
    await navigate("flashcards.html", { width: 1000, height: 820 });
    await gif("show-hard-setting", async () => {
      await click("#session-trigger");
      await sleep(700);
      await click("#show-hard");
      await sleep(700);
      await click("#session-trigger");
      await sleep(300);
      await click("#flip-card");
      await sleep(1500);
      await press("2");
      await sleep(900);
    });
    for (const theme of ["dark", "light"]) {
      await navigate("flashcards.html", { width: 1000, height: 820, theme });
      await click("#session-trigger");
      await sleep(1000);
      await shot(`session-menu-${theme}`, { selector: "#session-menu" });
    }
  }

  await navigate("flashcards.html", { width: 400, height: 820 });
  await click("#flip-card");
  await sleep(1100);
  await evaluate(`document.getElementById("rating-bar").scrollIntoView({ block: "end" })`);
  await sleep(200);
  await shot("narrow-400");
};
