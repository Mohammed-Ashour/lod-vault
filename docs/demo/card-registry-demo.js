// Demo of LodVaultCards.buildSkillQueue on fixture lexicons.
(async () => {
  const cards = globalThis.LodVaultCards;
  const ids = ["HAUS1", "FRA1", "MANN1", "GOEN1", "MAACHEN1", "GROUSS2"];
  const lexicons = {};
  for (const id of ids) {
    const raw = await (await fetch(`../../tests/fixtures/lod/${id}.json`)).json();
    lexicons[id] = globalThis.LodVaultLensLookup.parseLexicon(raw.entry, { now: Date.now() });
  }
  const day = (offset, hour = 9) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    date.setHours(hour, 0, 0, 0);
    return date.toISOString();
  };
  const known = (days, extra = {}) => ({
    reviews: [{ date: day(-days), rating: 2 }], totalReviews: 1, lastReviewedAt: day(-days), dueAt: day(days), interval: days, ...extra
  });
  const entries = ids.map((id) => ({ id, word: lexicons[id].lemma, pos: lexicons[id].pos, study: true }));
  const meta = {
    HAUS1: known(12),
    FRA1: known(9),
    "FRA1#pl": { ...known(3), dueAt: day(-1) },
    MANN1: known(2),
    GOEN1: { ...known(15), dueAt: day(0) },
    MAACHEN1: known(20, { reviews: [{ date: day(0, 8), rating: 2 }] }),
    GROUSS2: known(6)
  };
  const coreQueue = { dueEntries: entries.filter((entry) => entry.id === "GOEN1"), newEntries: [] };
  const skill = cards.buildSkillQueue(entries, meta, lexicons, { coreQueue });
  const todayIds = new Set([...skill.learning, ...skill.due, ...skill.fresh].map((card) => card.id));
  const reasons = {
    MANN1: "locked: core stability 2 d < 4 d",
    GOEN1: "core card due today → skills buried",
    MAACHEN1: "studied today → siblings buried"
  };

  const body = document.querySelector("#words tbody");
  for (const entry of entries) {
    const row = document.createElement("tr");
    const word = document.createElement("td");
    word.textContent = `${entry.word} (${entry.pos})`;
    const core = document.createElement("td");
    core.textContent = `S ≈ ${cards.stabilityDays(meta[entry.id])} d${cards.isSkillUnlocked(meta[entry.id]) ? "" : " · locked"}`;
    const applies = document.createElement("td");
    for (const id of cards.SKILL_IDS) {
      if (!cards.SKILLS[id].applies(lexicons[entry.id])) continue;
      const pill = document.createElement("span");
      const cardId = cards.cardId(entry.id, id);
      pill.className = `demo-pill${todayIds.has(cardId) ? " is-on" : ""}${skill.buried.includes(cardId) ? " is-buried" : ""}`;
      pill.textContent = `#${id} ${cards.SKILLS[id].label}${cards.normalizeSettings().skills[id] ? "" : " (off)"}`;
      applies.append(pill);
    }
    const today = document.createElement("td");
    const chosen = [...skill.due, ...skill.fresh].find((card) => card.entryId === entry.id);
    today.textContent = chosen
      ? `${chosen.id} · ${skill.due.includes(chosen) ? "due" : "new"}`
      : reasons[entry.id] || "–";
    row.append(word, core, applies, today);
    body.append(row);
  }

  const queue = cards.mergeTodayQueue(coreQueue, skill);
  const list = document.getElementById("queue");
  for (const card of queue) {
    const item = document.createElement("li");
    const tag = document.createElement("span");
    tag.className = "demo-tag";
    tag.textContent = card.skill ? (skill.due.some((due) => due.id === card.id) ? " skill · due" : " skill · new") : " core · due";
    item.append(`${card.id}  ${lexicons[card.entryId].lemma}`, tag);
    list.append(item);
  }
})();
