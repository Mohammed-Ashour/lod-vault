// Demo harness for LodVaultExercises on fixture lexicons.
(async () => {
  const [skill, id] = (location.hash.slice(1) || "g:HAUS1").split(":");
  const raw = await (await fetch(`../../tests/fixtures/lod/${id}.json`)).json();
  const lexicon = globalThis.LodVaultLensLookup.parseLexicon(raw.entry, { now: Date.now() });
  const entry = { id, word: lexicon.lemma, pos: lexicon.pos, study: true };
  const stage = document.getElementById("stage");
  const log = document.getElementById("log");
  const names = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };
  const params = new URLSearchParams(location.search);
  // A fixed sequence instead of Math.random, so recordings are repeatable.
  let seed = Number(params.get("seed")) || 7;
  const random = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const playAudio = (url) => {
    log.replaceChildren("♪ playing example audio ", Object.assign(document.createElement("code"), { textContent: url.split("/").pop() }));
  };
  const ctx = {
    lexicon,
    language: params.get("lang") || "en",
    random,
    playAudio,
    focus: params.get("focus") ? params.get("focus").split(",").map(Number) : [],
    // ?sense=2&ex=0 pins the sense and example instead of picking one.
    ...(() => {
      const sense = lexicon.senses.find((item) => item.n === Number(params.get("sense")));
      const example = sense?.ex?.[Number(params.get("ex")) || 0];
      return sense ? { sense, ...(example ? { example: skill === "cz" ? { sense, example } : example } : {}) } : {};
    })(),
    onGrade(grade, detail) {
      log.replaceChildren("Recorded ", Object.assign(document.createElement("strong"), { textContent: `${names[grade]} (${grade})` }), ` for ${id}#${skill} · ${JSON.stringify(detail)}`);
    }
  };
  const api = globalThis.LodVaultExercises;

  if (skill === "meaning") {
    const { front, back } = api.buildMeaningCard(document, entry, lexicon, ctx);
    stage.append(front, back);
    return;
  }
  if (skill === "leech") {
    api.renderLeechPanel(document, stage, { entry, lexicon, lapses: 6, note: "", focus: [] }, {
      language: ctx.language,
      onSave: (value) => log.textContent = `Saved: ${JSON.stringify(value)}`,
      onSuspend: () => log.textContent = `${id} paused: no more reviews until you resume it.`,
      onClose: () => log.textContent = "Closed"
    });
    return;
  }
  const controller = api.render(document, stage, { id: `${id}#${skill}`, entryId: id, skill, entry }, ctx);
  document.addEventListener("keydown", (event) => {
    if (event.target.matches?.("input, textarea") && event.key !== "Enter") return;
    if (event.target.matches?.("button") && (event.key === "Enter" || event.key === " ")) return;
    if (controller.handleKey(event)) event.preventDefault();
  });
})();
