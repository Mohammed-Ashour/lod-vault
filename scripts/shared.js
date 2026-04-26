(() => {
  const STORAGE_KEY = "lodVault.entries";
  const LEGACY_STORAGE_KEY = "lodWrapper.entries";
  const SETTINGS_KEY = "lodVault.settings";
  const DEFAULT_SETTINGS = {
    autoMode: false
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function getIdFromUrl(url) {
    if (!url) return "";
    const match = url.match(/\/artikel\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function cleanText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function cleanWordLabel(value) {
    return cleanText(value)
      .replace(/\s*kopéiert\b.*$/i, "")
      .replace(/\s*Artikel deelen\b.*$/i, "")
      .trim();
  }

  function cleanTranslations(translations = {}) {
    const result = {};
    for (const [lang, value] of Object.entries(translations || {})) {
      const cleaned = cleanText(value);
      if (cleaned) result[lang] = cleaned;
    }
    return result;
  }

  function normalizeVisitCount(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  }

  function isExtensionContextInvalidated(error) {
    return String(error || "").includes("Extension context invalidated");
  }

  function createRefreshPageError() {
    return new Error("Extension updated — refresh the page.");
  }

  function normalizeEntry(entry = {}) {
    const id = cleanText(entry.id) || getIdFromUrl(entry.url);
    return {
      id,
      word: cleanWordLabel(entry.word),
      url: cleanText(entry.url),
      pos: cleanText(entry.pos),
      inflection: cleanText(entry.inflection),
      example: cleanText(entry.example),
      note: cleanText(entry.note),
      translations: cleanTranslations(entry.translations),
      favorite: Boolean(entry.favorite),
      study: Boolean(entry.study),
      history: Boolean(entry.history),
      visitCount: normalizeVisitCount(entry.visitCount),
      lastVisitedAt: cleanText(entry.lastVisitedAt),
      createdAt: cleanText(entry.createdAt),
      updatedAt: cleanText(entry.updatedAt)
    };
  }

  function shouldKeepEntry(entry) {
    return Boolean(entry?.favorite || entry?.study || entry?.history);
  }

  function mergeEntry(existing, incoming) {
    const current = normalizeEntry(existing);
    const next = normalizeEntry(incoming);
    const merged = {
      id: current.id || next.id,
      word: next.word || current.word,
      url: next.url || current.url,
      pos: next.pos || current.pos,
      inflection: next.inflection || current.inflection,
      example: next.example || current.example,
      note: next.note || current.note,
      translations: {
        ...current.translations,
        ...next.translations
      },
      favorite: Boolean(current.favorite),
      study: Boolean(current.study),
      history: Boolean(current.history),
      visitCount: normalizeVisitCount(current.visitCount || next.visitCount),
      lastVisitedAt: current.lastVisitedAt || next.lastVisitedAt,
      createdAt: current.createdAt || next.createdAt || nowIso(),
      updatedAt: nowIso()
    };

    if (!Object.keys(merged.translations).length) {
      delete merged.translations;
    }

    if (!merged.visitCount) {
      delete merged.visitCount;
    }

    if (!merged.lastVisitedAt) {
      delete merged.lastVisitedAt;
    }

    return merged;
  }

  function countStoredEntries(entryMap) {
    return Object.values(entryMap || {})
      .map(normalizeEntry)
      .filter((entry) => entry.id && entry.word && shouldKeepEntry(entry)).length;
  }

  async function getEntryMap() {
    try {
      const data = await chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY]);
      if (data[STORAGE_KEY]) {
        return data[STORAGE_KEY] || {};
      }

      if (data[LEGACY_STORAGE_KEY]) {
        const migrated = data[LEGACY_STORAGE_KEY] || {};
        await chrome.storage.local.set({ [STORAGE_KEY]: migrated });
        await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
        return migrated;
      }

      return {};
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        return {};
      }
      throw error;
    }
  }

  async function saveEntryMap(entryMap) {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: entryMap });
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        throw createRefreshPageError();
      }
      throw error;
    }
  }

  async function getSettings() {
    try {
      const data = await chrome.storage.local.get([SETTINGS_KEY]);
      return {
        ...DEFAULT_SETTINGS,
        ...(data[SETTINGS_KEY] || {})
      };
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        return { ...DEFAULT_SETTINGS };
      }
      throw error;
    }
  }

  async function getAutoMode() {
    const settings = await getSettings();
    return Boolean(settings.autoMode);
  }

  async function setAutoMode(enabled) {
    const nextSettings = {
      ...(await getSettings()),
      autoMode: Boolean(enabled)
    };

    try {
      await chrome.storage.local.set({ [SETTINGS_KEY]: nextSettings });
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        throw createRefreshPageError();
      }
      throw error;
    }

    return nextSettings.autoMode;
  }

  async function getEntries() {
    const entryMap = await getEntryMap();
    return Object.values(entryMap)
      .map(normalizeEntry)
      .filter((entry) => entry.id && entry.word && shouldKeepEntry(entry))
      .sort((a, b) => {
        const aTime = new Date(a.updatedAt || a.lastVisitedAt || a.createdAt || 0).getTime();
        const bTime = new Date(b.updatedAt || b.lastVisitedAt || b.createdAt || 0).getTime();
        return bTime - aTime;
      });
  }

  async function getEntry(id) {
    if (!id) return null;
    const entryMap = await getEntryMap();
    const entry = entryMap[id] ? normalizeEntry(entryMap[id]) : null;
    return entry && shouldKeepEntry(entry) ? entry : null;
  }

  async function toggleList(entry, listName) {
    if (!["favorite", "study"].includes(listName)) {
      throw new Error(`Unsupported list: ${listName}`);
    }

    const normalized = normalizeEntry(entry);
    if (!normalized.id || !normalized.word) {
      throw new Error("Cannot save an empty entry.");
    }

    const entryMap = await getEntryMap();
    const existing = entryMap[normalized.id];
    const merged = mergeEntry(existing, normalized);

    merged.favorite = Boolean(existing?.favorite);
    merged.study = Boolean(existing?.study);
    merged.history = Boolean(existing?.history);
    merged.visitCount = normalizeVisitCount(existing?.visitCount);
    merged.lastVisitedAt = cleanText(existing?.lastVisitedAt);
    merged[listName] = !merged[listName];

    if (!shouldKeepEntry(merged)) {
      delete entryMap[normalized.id];
      await saveEntryMap(entryMap);
      return null;
    }

    entryMap[normalized.id] = merged;
    await saveEntryMap(entryMap);
    return normalizeEntry(merged);
  }

  async function recordAutoVisit(entry) {
    const normalized = normalizeEntry(entry);
    if (!normalized.id || !normalized.word) {
      throw new Error("Cannot save an empty entry.");
    }

    const entryMap = await getEntryMap();
    const existing = entryMap[normalized.id];
    const merged = mergeEntry(existing, normalized);
    const visitedAt = nowIso();

    merged.favorite = Boolean(existing?.favorite);
    merged.study = true;
    merged.history = true;
    merged.visitCount = normalizeVisitCount(existing?.visitCount) + 1;
    merged.lastVisitedAt = visitedAt;
    merged.updatedAt = visitedAt;
    merged.createdAt = merged.createdAt || visitedAt;

    entryMap[normalized.id] = merged;
    await saveEntryMap(entryMap);
    return normalizeEntry(merged);
  }

  async function removeFromHistory(id) {
    if (!id) return null;

    const entryMap = await getEntryMap();
    const existing = entryMap[id];
    if (!existing) return null;

    const merged = mergeEntry(existing, existing);
    merged.favorite = Boolean(existing.favorite);
    merged.study = Boolean(existing.study);
    merged.history = false;
    delete merged.visitCount;
    delete merged.lastVisitedAt;

    if (!shouldKeepEntry(merged)) {
      delete entryMap[id];
      await saveEntryMap(entryMap);
      return null;
    }

    entryMap[id] = merged;
    await saveEntryMap(entryMap);
    return normalizeEntry(merged);
  }

  async function saveNote(id, note) {
    if (!id) throw new Error("Missing entry id.");

    const entryMap = await getEntryMap();
    const existing = entryMap[id];
    if (!existing) throw new Error("Entry not found.");

    const merged = mergeEntry(existing, existing);

    merged.note = cleanText(note);
    merged.favorite = Boolean(existing.favorite);
    merged.study = Boolean(existing.study);
    merged.history = Boolean(existing.history);
    merged.visitCount = normalizeVisitCount(existing.visitCount);
    merged.lastVisitedAt = cleanText(existing.lastVisitedAt);
    entryMap[id] = merged;
    await saveEntryMap(entryMap);
    return normalizeEntry(merged);
  }

  async function removeEntry(id) {
    if (!id) return;
    const entryMap = await getEntryMap();
    delete entryMap[id];
    await saveEntryMap(entryMap);
  }

  function buildSearchText(entry) {
    return [
      entry.word,
      entry.pos,
      entry.inflection,
      entry.example,
      entry.note,
      ...Object.values(entry.translations || {})
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function buildJsonExport(entries) {
    return JSON.stringify(
      {
        app: "lodvault",
        version: 1,
        exportedAt: nowIso(),
        entries: entries.map(normalizeEntry)
      },
      null,
      2
    );
  }

  async function importJson(text) {
    const parsed = JSON.parse(text);
    const incomingEntries = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.entries) ? parsed.entries : [];
    if (!incomingEntries.length) {
      return { imported: 0, total: 0 };
    }

    const entryMap = await getEntryMap();
    let imported = 0;

    for (const rawEntry of incomingEntries) {
      const incoming = normalizeEntry(rawEntry);
      if (!incoming.id || !incoming.word) continue;
      if (!shouldKeepEntry(incoming)) continue;

      const existing = entryMap[incoming.id];
      const merged = mergeEntry(existing, incoming);
      merged.favorite = Boolean(existing?.favorite) || Boolean(incoming.favorite);
      merged.study = Boolean(existing?.study) || Boolean(incoming.study);
      merged.history = Boolean(existing?.history) || Boolean(incoming.history);
      merged.visitCount = merged.history
        ? Math.max(normalizeVisitCount(existing?.visitCount), normalizeVisitCount(incoming.visitCount), 1)
        : 0;
      merged.lastVisitedAt = incoming.lastVisitedAt || cleanText(existing?.lastVisitedAt);
      merged.note = incoming.note || merged.note;

      if (!merged.visitCount) {
        delete merged.visitCount;
      }
      if (!merged.lastVisitedAt) {
        delete merged.lastVisitedAt;
      }

      entryMap[incoming.id] = merged;
      imported += 1;
    }

    await saveEntryMap(entryMap);
    return { imported, total: countStoredEntries(entryMap) };
  }

  function downloadTextFile(filename, content, mimeType = "text/plain") {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    link.click();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatWhen(value) {
    if (!value) return "";
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(new Date(value));
    } catch {
      return value;
    }
  }

  function buildVisitMeta(entry) {
    if (!entry.history) return "";

    const parts = [];
    const visitCount = normalizeVisitCount(entry.visitCount) || 1;
    parts.push(`Visited ${visitCount} time${visitCount === 1 ? "" : "s"}`);
    if (entry.lastVisitedAt) {
      parts.push(`Last visited ${formatWhen(entry.lastVisitedAt)}`);
    }

    return parts.join(" · ");
  }

  function buildEntryMarkup(entry) {
    const chips = [];
    const activeLists = [];
    if (entry.favorite) activeLists.push("favorite");
    if (entry.study)    activeLists.push("study");
    if (entry.history)  activeLists.push("history");

    const translationPairs = [
      ["en", "EN"], ["fr", "FR"], ["de", "DE"], ["pt", "PT"], ["nl", "NL"]
    ];

    if (entry.pos) {
      chips.push(`<span class="chip chip-type">${escapeHtml(entry.pos)}</span>`);
    }

    if (entry.favorite) chips.push('<span class="chip chip-list-favorite">Favorite</span>');
    if (entry.study)    chips.push('<span class="chip chip-list-study">Study</span>');
    if (entry.history)  chips.push('<span class="chip chip-list-history">History</span>');

    for (const [key, label] of translationPairs) {
      if (entry.translations?.[key]) {
        chips.push(`<span class="chip" data-lang="${key}">${label}: ${escapeHtml(entry.translations[key])}</span>`);
      }
    }

    return `
      <article class="entry" data-id="${escapeHtml(entry.id)}" data-lists="${escapeHtml(activeLists.join(","))}" data-search="${escapeHtml(buildSearchText(entry))}">
        <div class="entry-top">
          <h3><a href="${escapeHtml(entry.url)}" target="_blank" rel="noreferrer">${escapeHtml(entry.word)}</a></h3>
          <span class="timestamp">${escapeHtml(formatWhen(entry.updatedAt || entry.lastVisitedAt || entry.createdAt))}</span>
        </div>
        ${chips.length ? `<div class="chips">${chips.join("")}</div>` : ""}
        ${buildVisitMeta(entry) ? `<p class="visit-meta">${escapeHtml(buildVisitMeta(entry))}</p>` : ""}
        ${entry.inflection ? `<p class="detail"><strong>Inflection:</strong> ${escapeHtml(entry.inflection)}</p>` : ""}
        ${entry.example ? `<blockquote>${escapeHtml(entry.example)}</blockquote>` : ""}
        ${entry.note ? `<p class="note"><strong>Note:</strong> ${escapeHtml(entry.note)}</p>` : ""}
      </article>
    `;
  }

  function buildExportSearchScriptTag() {
    return `
  <script>
    const input = document.getElementById('search-input');
    const status = document.getElementById('search-status');
    const empty = document.getElementById('search-empty');
    const entries = Array.from(document.querySelectorAll('.entry'));

    function applySearch() {
      const query = (input.value || '').trim().toLowerCase();
      let visibleCount = 0;

      for (const entry of entries) {
        const match = !query || (entry.dataset.search || '').includes(query);
        entry.hidden = !match;
        if (match) visibleCount += 1;
      }

      status.textContent = query
        ? visibleCount + ' matching word' + (visibleCount === 1 ? '' : 's')
        : entries.length + ' saved word' + (entries.length === 1 ? '' : 's');
      empty.hidden = visibleCount !== 0 || !query;
    }

    input.addEventListener('input', applySearch);
    applySearch();
  </script>`;
  }

  function buildExportHtml(entries, options = {}) {
    const { includeInlineScript = true } = options;
    const exportedAt = formatWhen(nowIso());

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LODVault Export</title>
  <style>
    :root {
      color-scheme: dark;
      --bg:      #0d1c2e;
      --surface: #132333;
      --border:  #1e3348;
      --text:    #ddeef5;
      --muted:   #5f8fa8;
      --teal:    #39a7c4;
      --teal-lt: #a8dadc;
      --blue:    #457b9d;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg); color: var(--text);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.55; padding: 32px 20px 56px;
    }
    main { max-width: 760px; margin: 0 auto; }
    .page-header { margin-bottom: 24px; }
    h1 { font-size: 1.5rem; font-weight: 700; color: #fff; margin-bottom: 3px; }
    .meta { color: var(--muted); font-size: 13.5px; }
    .search-input {
      display: block; width: 100%; margin-top: 14px;
      padding: 10px 14px; background: var(--surface);
      border: 1px solid var(--border); border-radius: 7px;
      color: var(--text); font: inherit; font-size: 14px;
    }
    .search-input::placeholder { color: var(--muted); }
    .search-input:focus { outline: none; border-color: var(--teal); }
    .search-status { margin-top: 8px; color: var(--muted); font-size: 13px; }
    .section-label {
      font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--teal); margin: 24px 0 12px;
    }
    .entry {
      padding: 14px; background: var(--surface);
      border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px;
    }
    .entry[hidden] { display: none; }
    .entry-top {
      display: flex; justify-content: space-between;
      align-items: flex-start; gap: 12px; flex-wrap: wrap;
    }
    .entry-top h3 { font-size: 1rem; font-weight: 700; color: #fff; }
    .entry-top a { color: var(--teal-lt); text-decoration: none; }
    .entry-top a:hover { text-decoration: underline; }
    .timestamp { color: var(--muted); font-size: 11.5px; white-space: nowrap; flex-shrink: 0; }
    .chips { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; }
    .chip {
      padding: 2px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 700;
      background: rgba(57,167,196,0.12); color: var(--teal-lt); border: 1px solid rgba(57,167,196,0.22);
    }
    .chip-type         { background: rgba(100,200,140,0.10); color: #7dd4a8;        border-color: rgba(100,200,140,0.20); }
    .chip-list-favorite{ background: rgba(253,215,120,0.10); color: #e6c560;        border-color: rgba(253,215,120,0.20); }
    .chip-list-study   { background: rgba(57,167,196,0.12);  color: var(--teal-lt); border-color: rgba(57,167,196,0.22); }
    .chip-list-history { background: rgba(121,134,203,0.10); color: #9ba8d8;        border-color: rgba(121,134,203,0.20); }
    .visit-meta, .detail { margin-top: 8px; color: var(--muted); font-size: 12.5px; }
    blockquote {
      margin-top: 10px; padding: 10px 14px;
      border-left: 3px solid var(--teal); background: rgba(57,167,196,0.07);
      border-radius: 6px; color: var(--teal-lt); font-size: 13.5px;
    }
    .note {
      margin-top: 10px; padding: 10px 14px;
      border-left: 3px solid #7986cb; background: rgba(121,134,203,0.07);
      border-radius: 6px; font-size: 13.5px;
    }
    .empty { color: var(--muted); font-size: 13.5px; padding: 16px 0; }
    #search-empty[hidden] { display: none; }
    @media (max-width: 640px) { body { padding: 20px 12px 40px; } }
  </style>
</head>
<body>
  <main>
    <div class="page-header">
      <h1>LODVault</h1>
      <p class="meta">Exported ${escapeHtml(exportedAt)} &middot; ${entries.length} saved word${entries.length === 1 ? "" : "s"}</p>
      <input id="search-input" class="search-input" type="search" placeholder="Search words, type, translation, note&hellip;" autocomplete="off">
      <p id="search-status" class="search-status">${entries.length} saved word${entries.length === 1 ? "" : "s"}</p>
    </div>

    <p id="search-empty" class="empty" hidden>No words match your search.</p>

    <p class="section-label">Saved words (${entries.length})</p>
    ${entries.length ? entries.map((entry) => buildEntryMarkup(entry)).join("") : '<p class="empty">No saved words yet.</p>'}
  </main>
  ${includeInlineScript ? buildExportSearchScriptTag() : ""}
</body>
</html>`;
  }

  globalThis.LodWrapperStore = {
    STORAGE_KEY,
    LEGACY_STORAGE_KEY,
    SETTINGS_KEY,
    getIdFromUrl,
    normalizeEntry,
    getSettings,
    getAutoMode,
    setAutoMode,
    getEntries,
    getEntry,
    toggleList,
    recordAutoVisit,
    removeFromHistory,
    saveNote,
    removeEntry,
    buildSearchText,
    buildJsonExport,
    importJson,
    downloadTextFile,
    escapeHtml,
    formatWhen,
    buildExportHtml
  };
})();
