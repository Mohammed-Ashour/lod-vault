// Tags and saved decks.
//
// Tags are not entry fields (normalizeEntry drops unknown fields and every
// sync format would need to learn them). They live in one small record with
// the learner's saved decks:
//   local "lodVault.tags", synced as "lodVault.t":
//   { v: 1,
//     t: { [tag]: [ids, updatedAtMs] },        // a tag with no ids is a deletion
//     k: { [deckId]: [deck, updatedAtMs] } }    // deck = { name, f: filter } or null when deleted
// Each tag and each deck merges on its own: the later write wins. The synced
// copy stays under the 8 KB item limit; what doesn't fit stays on this device.
//
// A deck is a saved filter over saved words:
//   { tag, pos: "noun"|"verb"|"adj"|"adv"|"other", gender: "m"|"f"|"n",
//     level: "A1".."C2", list: "favorites"|"study", leech: true, dueWithin: days }
// Flashcards gets them, plus a deck per GWS level when downloaded word details
// (lodVault.lx.<ID>) say so, through attach() and filterEntries().
(() => {
  const TAGS_KEY = "lodVault.tags";
  const SYNC_TAGS_KEY = "lodVault.t";
  const LEXICON_PREFIX = "lodVault.lx.";
  const DECK_PREFIX = "deck:";
  const LEVEL_PREFIX = "level:";
  const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const SYNC_MAX_BYTES = 7000;
  const TOMBSTONE_DAYS = 60;
  const MAX_TAG_LENGTH = 32;
  const POS_LABELS = { noun: "Nouns", verb: "Verbs", adj: "Adjectives", adv: "Adverbs", other: "Other" };
  const GENDER_LABELS = { m: "masculine", f: "feminine", n: "neuter" };

  function store() {
    return globalThis.LodVaultStore || {};
  }

  function cleanTag(value) {
    return String(value ?? "")
      .normalize("NFC")
      .replace(/[\u0000-\u001f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_TAG_LENGTH);
  }

  function cleanIds(ids) {
    return [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id ?? "").trim()).filter(Boolean))].sort();
  }

  function stamp(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function normalizeFilter(raw) {
    const filter = {};
    if (!raw || typeof raw !== "object") return filter;
    const tag = cleanTag(raw.tag);
    if (tag) filter.tag = tag;
    if (POS_LABELS[raw.pos]) filter.pos = raw.pos;
    if (GENDER_LABELS[raw.gender]) filter.gender = raw.gender;
    if (LEVELS.includes(raw.level)) filter.level = raw.level;
    if (raw.list === "favorites" || raw.list === "study") filter.list = raw.list;
    if (raw.leech === true) filter.leech = true;
    const due = Math.floor(Number(raw.dueWithin));
    if (Number.isFinite(due) && due >= 0 && due <= 365 && raw.dueWithin !== "" && raw.dueWithin != null) filter.dueWithin = due;
    return filter;
  }

  function normalizeDeck(raw) {
    if (!raw || typeof raw !== "object") return null;
    const name = cleanTag(raw.name) || "My deck";
    return { name, f: normalizeFilter(raw.f) };
  }

  function normalizeOrg(raw) {
    const org = { v: 1, t: {}, k: {} };
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return org;
    for (const [rawTag, value] of Object.entries(raw.t && typeof raw.t === "object" ? raw.t : {})) {
      const tag = cleanTag(rawTag);
      if (!tag || !Array.isArray(value)) continue;
      org.t[tag] = [cleanIds(value[0]), stamp(value[1])];
    }
    for (const [rawId, value] of Object.entries(raw.k && typeof raw.k === "object" ? raw.k : {})) {
      const id = String(rawId).replace(/[^\w-]/g, "").slice(0, 40);
      if (!id || !Array.isArray(value)) continue;
      org.k[id] = [value[0] === null ? null : normalizeDeck(value[0]), stamp(value[1])];
    }
    return org;
  }

  function mergeOrg(localRaw, remoteRaw) {
    const local = normalizeOrg(localRaw);
    const remote = normalizeOrg(remoteRaw);
    const merged = { v: 1, t: { ...local.t }, k: { ...local.k } };
    for (const [tag, value] of Object.entries(remote.t)) {
      if (!merged.t[tag] || value[1] > merged.t[tag][1]) merged.t[tag] = value;
    }
    for (const [id, value] of Object.entries(remote.k)) {
      if (!merged.k[id] || value[1] > merged.k[id][1]) merged.k[id] = value;
    }
    return merged;
  }

  function sameOrg(left, right) {
    return JSON.stringify(normalizeOrg(left)) === JSON.stringify(normalizeOrg(right));
  }

  function pruneTombstones(org, now = Date.now()) {
    const cutoff = now - TOMBSTONE_DAYS * 86400000;
    const result = { v: 1, t: {}, k: {} };
    for (const [tag, value] of Object.entries(org.t)) {
      if (value[0].length || value[1] >= cutoff) result.t[tag] = value;
    }
    for (const [id, value] of Object.entries(org.k)) {
      if (value[0] || value[1] >= cutoff) result.k[id] = value;
    }
    return result;
  }

  function byteLength(value) {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  }

  // Decks first, then tags by most recent edit, until the item is full.
  function buildSyncValue(raw, { now = Date.now(), maxBytes = SYNC_MAX_BYTES } = {}) {
    const org = pruneTombstones(normalizeOrg(raw), now);
    if (!Object.keys(org.t).length && !Object.keys(org.k).length) return null;
    if (byteLength(org) <= maxBytes) return org;
    const result = { v: 1, t: {}, k: {} };
    const items = [
      ...Object.entries(org.k).map(([key, value]) => ["k", key, value]),
      ...Object.entries(org.t).sort((left, right) => right[1][1] - left[1][1]).map(([key, value]) => ["t", key, value])
    ];
    for (const [kind, key, value] of items) {
      result[kind][key] = value;
      if (byteLength(result) > maxBytes) delete result[kind][key];
    }
    return result;
  }

  function hasNews(localRaw, remoteRaw) {
    const local = buildSyncValue(localRaw);
    if (!local) return false;
    if (!remoteRaw) return true;
    return !sameOrg(mergeOrg(remoteRaw, local), remoteRaw);
  }

  let writeQueue = Promise.resolve();
  function enqueue(task) {
    const result = writeQueue.then(task, task);
    writeQueue = result.catch(() => {});
    return result;
  }

  async function readOrg() {
    const data = await chrome.storage.local.get([TAGS_KEY]);
    return normalizeOrg(data[TAGS_KEY]);
  }

  async function updateOrg(mutate) {
    return enqueue(async () => {
      const previous = await readOrg();
      const next = normalizeOrg(mutate(JSON.parse(JSON.stringify(previous))) || previous);
      if (sameOrg(previous, next)) return { changed: false, org: previous };
      await chrome.storage.local.set({ [TAGS_KEY]: next });
      return { changed: true, org: next };
    });
  }

  async function applyRemote(remoteRaw) {
    return updateOrg((org) => mergeOrg(org, remoteRaw));
  }

  // ── Tags ──────────────────────────────────────────────────
  function tagsById(org) {
    const map = {};
    for (const [tag, [ids]] of Object.entries(normalizeOrg(org).t)) {
      for (const id of ids) (map[id] = map[id] || []).push(tag);
    }
    for (const tags of Object.values(map)) tags.sort((left, right) => left.localeCompare(right));
    return map;
  }

  // Tags with at least one saved word, with their counts.
  function listTags(org, entries = null) {
    const saved = entries ? new Set(entries.map((entry) => entry.id)) : null;
    return Object.entries(normalizeOrg(org).t)
      .map(([tag, [ids]]) => [tag, saved ? ids.filter((id) => saved.has(id)).length : ids.length])
      .filter(([, count]) => count > 0)
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([tag, count]) => ({ tag, count }));
  }

  async function setEntryTags(entryId, tags, now = Date.now()) {
    const id = String(entryId || "").trim();
    if (!id) throw new Error("Missing entry id.");
    const wanted = new Set((Array.isArray(tags) ? tags : []).map(cleanTag).filter(Boolean));
    return updateOrg((org) => {
      for (const [tag, value] of Object.entries(org.t)) {
        const has = value[0].includes(id);
        if (has && !wanted.has(tag)) org.t[tag] = [value[0].filter((item) => item !== id), now];
      }
      for (const tag of wanted) {
        const value = org.t[tag] || [[], 0];
        if (!value[0].includes(id)) org.t[tag] = [[...value[0], id], now];
      }
      return org;
    });
  }

  async function addTagToEntries(tag, entryIds, now = Date.now()) {
    const clean = cleanTag(tag);
    if (!clean) return { changed: false };
    return updateOrg((org) => {
      const value = org.t[clean] || [[], 0];
      const ids = cleanIds([...value[0], ...entryIds]);
      if (ids.length !== value[0].length) org.t[clean] = [ids, now];
      return org;
    });
  }

  async function deleteTag(tag, now = Date.now()) {
    const clean = cleanTag(tag);
    return updateOrg((org) => {
      if (org.t[clean]) org.t[clean] = [[], now];
      return org;
    });
  }

  // ── Decks ─────────────────────────────────────────────────
  async function saveDeck(deck, { id = null, now = Date.now() } = {}) {
    const normalized = normalizeDeck(deck);
    if (!normalized) throw new Error("Invalid deck.");
    const deckId = id || `d${now.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    const result = await updateOrg((org) => {
      org.k[deckId] = [normalized, now];
      return org;
    });
    return { ...result, id: deckId };
  }

  async function deleteDeck(id, now = Date.now()) {
    return updateOrg((org) => {
      if (org.k[id]) org.k[id] = [null, now];
      return org;
    });
  }

  function listDecks(org) {
    return Object.entries(normalizeOrg(org).k)
      .filter(([, [deck]]) => deck)
      .map(([id, [deck]]) => ({ id, name: deck.name, f: deck.f }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  function posGroup(value) {
    const text = String(value || "").trim().toUpperCase();
    if (!text) return "other";
    if (text.startsWith("SUBST") || text.startsWith("NOUN") || text === "N") return "noun";
    if (text.startsWith("VRB") || text.startsWith("VERB") || text === "V") return "verb";
    if (text.startsWith("ADJ")) return "adj";
    if (text.startsWith("ADV")) return "adv";
    return "other";
  }

  function genderOf(entry, lexicon) {
    const fromLexicon = String(lexicon?.gender || "").toLowerCase();
    if (GENDER_LABELS[fromLexicon]) return fromLexicon;
    const match = /^SUBST\+([MFN])/i.exec(String(lexicon?.pos || entry?.pos || ""));
    return match ? match[1].toLowerCase() : null;
  }

  function levelsOf(lexicon) {
    const levels = new Set();
    for (const cat of Array.isArray(lexicon?.cats) ? lexicon.cats : []) {
      const code = typeof cat === "string" ? cat : cat?.code;
      const match = /^GWS\s+(A1|A2|B1|B2|C1|C2)\b/i.exec(String(code || ""));
      if (match) levels.add(match[1].toUpperCase());
    }
    return levels;
  }

  function matchesFilter(entry, filter = {}, context = {}) {
    const { meta = {}, tags = {}, lexicon = {}, now = new Date() } = context;
    const lx = lexicon[entry.id] || null;
    const card = meta[entry.id];
    if (filter.tag && !(tags[entry.id] || []).includes(filter.tag)) return false;
    if (filter.pos && posGroup(lx?.pos || entry.pos) !== filter.pos) return false;
    if (filter.gender && genderOf(entry, lx) !== filter.gender) return false;
    if (filter.level && !levelsOf(lx).has(filter.level)) return false;
    if (filter.list === "favorites" && !entry.favorite) return false;
    if (filter.list === "study" && !entry.study) return false;
    if (filter.leech && !card?.leech) return false;
    if (filter.dueWithin !== undefined) {
      const due = Date.parse(card?.dueAt || "");
      if (!card?.totalReviews || !Number.isFinite(due)) return false;
      const limit = new Date(now);
      limit.setHours(0, 0, 0, 0);
      limit.setDate(limit.getDate() + filter.dueWithin + 1);
      if (due >= limit.getTime()) return false;
    }
    return true;
  }

  function describeFilter(filter = {}) {
    const parts = [];
    if (filter.tag) parts.push(`#${filter.tag}`);
    if (filter.pos) parts.push(POS_LABELS[filter.pos].toLowerCase());
    if (filter.gender) parts.push(GENDER_LABELS[filter.gender]);
    if (filter.level) parts.push(`level ${filter.level}`);
    if (filter.list) parts.push(filter.list === "favorites" ? "favorites" : "study list");
    if (filter.leech) parts.push("leeches");
    if (filter.dueWithin !== undefined) parts.push(filter.dueWithin ? `due within ${filter.dueWithin} days` : "due today");
    return parts.join(" · ") || "all saved words";
  }

  // ── Flashcards deck select ────────────────────────────────
  const cache = { org: normalizeOrg(null), lexicon: {}, tags: {} };

  async function readLexicon(ids = []) {
    if (!ids.length) return {};
    const data = await chrome.storage.local.get(ids.map((id) => `${LEXICON_PREFIX}${id}`));
    const result = {};
    for (const id of ids) {
      const value = data[`${LEXICON_PREFIX}${id}`];
      if (value && typeof value === "object" && !Array.isArray(value)) result[id] = value;
    }
    return result;
  }

  async function load(entries = []) {
    const [org, lexicon] = await Promise.all([readOrg(), readLexicon(entries.map((entry) => entry.id))]);
    cache.org = org;
    cache.lexicon = lexicon;
    cache.tags = tagsById(org);
    return cache;
  }

  function isDeckValue(value) {
    const text = String(value || "");
    if (text.startsWith(DECK_PREFIX)) return Boolean(cache.org.k[text.slice(DECK_PREFIX.length)]?.[0]);
    if (text.startsWith(LEVEL_PREFIX)) return LEVELS.includes(text.slice(LEVEL_PREFIX.length));
    return false;
  }

  function filterFor(value) {
    const text = String(value || "");
    if (text.startsWith(DECK_PREFIX)) return cache.org.k[text.slice(DECK_PREFIX.length)]?.[0]?.f || null;
    if (text.startsWith(LEVEL_PREFIX)) return { level: text.slice(LEVEL_PREFIX.length) };
    return null;
  }

  function labelFor(value) {
    const text = String(value || "");
    if (text.startsWith(DECK_PREFIX)) return cache.org.k[text.slice(DECK_PREFIX.length)]?.[0]?.name || "";
    if (text.startsWith(LEVEL_PREFIX)) return `Level ${text.slice(LEVEL_PREFIX.length)}`;
    return "";
  }

  function filterEntries(value, entries = [], meta = {}, now = new Date()) {
    const filter = filterFor(value);
    if (!filter) return [];
    const context = { meta, tags: cache.tags, lexicon: cache.lexicon, now };
    return entries.filter((entry) => matchesFilter(entry, filter, context));
  }

  function deckOptions(entries = [], meta = {}, now = new Date()) {
    const context = { meta, tags: cache.tags, lexicon: cache.lexicon, now };
    const mine = listDecks(cache.org).map((deck) => ({
      value: `${DECK_PREFIX}${deck.id}`,
      label: deck.name,
      count: entries.filter((entry) => matchesFilter(entry, deck.f, context)).length
    }));
    const levels = LEVELS.map((level) => ({
      value: `${LEVEL_PREFIX}${level}`,
      label: `Level ${level}`,
      count: entries.filter((entry) => levelsOf(cache.lexicon[entry.id]).has(level)).length
    })).filter((option) => option.count > 0);
    return { mine, levels };
  }

  // Adds "My decks" and "Levels" groups to the Session deck select. The
  // built-in options stay as they are.
  function populateSelect(select, entries = [], meta = {}) {
    if (!select) return;
    const doc = select.ownerDocument;
    select.querySelectorAll("optgroup[data-lodvault-decks]").forEach((group) => group.remove());
    const { mine, levels } = deckOptions(entries, meta);
    const addGroup = (label, options) => {
      if (!options.length) return;
      const group = doc.createElement("optgroup");
      group.label = label;
      group.dataset.lodvaultDecks = "true";
      for (const option of options) {
        const node = doc.createElement("option");
        node.value = option.value;
        node.textContent = `${option.label} (${option.count})`;
        group.append(node);
      }
      select.append(group);
    };
    addGroup("My decks", mine);
    addGroup("Levels", levels);
  }

  async function attach(select, entries = [], meta = {}, { onChange } = {}) {
    await load(entries);
    populateSelect(select, entries, meta);
    if (onChange && !attach.listening) {
      attach.listening = true;
      chrome.storage?.onChanged?.addListener?.((changes, areaName) => {
        if (areaName !== "local") return;
        if (changes?.[TAGS_KEY] || Object.keys(changes || {}).some((key) => key.startsWith(LEXICON_PREFIX))) onChange();
      });
    }
  }

  // ── Sync and backup ───────────────────────────────────────
  globalThis.LodVaultSyncRecords = [...(globalThis.LodVaultSyncRecords || []), {
    name: "tags",
    localKey: TAGS_KEY,
    syncKey: SYNC_TAGS_KEY,
    buildSyncValue: (local) => buildSyncValue(local),
    async applyRemote(remote) {
      const result = await applyRemote(remote);
      return { changed: result.changed, record: result.org };
    },
    hasNews
  }];

  store().registerBackupSection?.("tags", {
    exportData: readOrg,
    importData: applyRemote
  });

  globalThis.LodVaultDecks = {
    TAGS_KEY,
    SYNC_TAGS_KEY,
    LEVELS,
    POS_LABELS,
    GENDER_LABELS,
    DECK_PREFIX,
    LEVEL_PREFIX,
    cleanTag,
    normalizeFilter,
    normalizeOrg,
    mergeOrg,
    buildSyncValue,
    hasNews,
    readOrg,
    applyRemote,
    tagsById,
    listTags,
    setEntryTags,
    addTagToEntries,
    deleteTag,
    saveDeck,
    deleteDeck,
    listDecks,
    posGroup,
    genderOf,
    levelsOf,
    matchesFilter,
    describeFilter,
    readLexicon,
    load,
    isDeckValue,
    labelFor,
    filterEntries,
    deckOptions,
    populateSelect,
    attach
  };
})();
