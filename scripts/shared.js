(() => {
  const STORAGE_KEY = "lodVault.entries";
  const LEGACY_STORAGE_KEY = "lodWrapper.entries";

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
      createdAt: cleanText(entry.createdAt),
      updatedAt: cleanText(entry.updatedAt)
    };
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
      createdAt: current.createdAt || next.createdAt || nowIso(),
      updatedAt: nowIso()
    };

    if (!Object.keys(merged.translations).length) {
      delete merged.translations;
    }

    return merged;
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

  async function getEntries() {
    const entryMap = await getEntryMap();
    return Object.values(entryMap)
      .map(normalizeEntry)
      .filter((entry) => entry.id && entry.word)
      .sort((a, b) => {
        const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return bTime - aTime;
      });
  }

  async function getEntry(id) {
    if (!id) return null;
    const entryMap = await getEntryMap();
    return entryMap[id] ? normalizeEntry(entryMap[id]) : null;
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
    merged[listName] = !merged[listName];

    if (!merged.favorite && !merged.study) {
      delete entryMap[normalized.id];
      await saveEntryMap(entryMap);
      return null;
    }

    entryMap[normalized.id] = merged;
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
      if (!incoming.favorite && !incoming.study) continue;

      const existing = entryMap[incoming.id];
      const merged = mergeEntry(existing, incoming);
      merged.favorite = Boolean(existing?.favorite) || Boolean(incoming.favorite);
      merged.study = Boolean(existing?.study) || Boolean(incoming.study);
      merged.note = incoming.note || merged.note;
      entryMap[incoming.id] = merged;
      imported += 1;
    }

    await saveEntryMap(entryMap);
    return { imported, total: Object.keys(entryMap).length };
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

  function buildEntryMarkup(entry, listName = "") {
    const chips = [];
    const translationPairs = [
      ["en", "EN"],
      ["fr", "FR"],
      ["de", "DE"],
      ["pt", "PT"],
      ["nl", "NL"]
    ];

    if (entry.pos) {
      chips.push(`<span class="chip chip-type">Type: ${escapeHtml(entry.pos)}</span>`);
    }

    if (entry.favorite) {
      chips.push('<span class="chip chip-list chip-list-favorite">Favorite</span>');
    }

    if (entry.study) {
      chips.push('<span class="chip chip-list chip-list-study">Study</span>');
    }

    for (const [key, label] of translationPairs) {
      if (entry.translations?.[key]) {
        chips.push(`<span class="chip">${label}: ${escapeHtml(entry.translations[key])}</span>`);
      }
    }

    return `
      <article class="entry" data-id="${escapeHtml(entry.id)}" data-list="${escapeHtml(listName)}" data-search="${escapeHtml(buildSearchText(entry))}">
        <div class="entry-top">
          <h3><a href="${escapeHtml(entry.url)}" target="_blank" rel="noreferrer">${escapeHtml(entry.word)}</a></h3>
          <span class="timestamp">${escapeHtml(formatWhen(entry.updatedAt || entry.createdAt))}</span>
        </div>
        ${chips.length ? `<div class="chips">${chips.join("")}</div>` : ""}
        ${entry.inflection ? `<p><strong>Inflection:</strong> ${escapeHtml(entry.inflection)}</p>` : ""}
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
    const favorites = entries.filter((entry) => entry.favorite);
    const study = entries.filter((entry) => entry.study);
    const exportedAt = formatWhen(nowIso());

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LODVault Export</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f8fb;
      --card: #ffffff;
      --text: #122033;
      --muted: #5f6c7b;
      --border: #d7dfeb;
      --accent: #2153ff;
      --accent-soft: #edf2ff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 32px 16px 56px;
    }
    main {
      max-width: 960px;
      margin: 0 auto;
    }
    header {
      margin-bottom: 24px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 2rem;
    }
    p.meta {
      color: var(--muted);
      margin: 0;
    }
    .search-panel {
      margin-top: 18px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 14px;
    }
    .search-input {
      width: 100%;
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: 12px;
      font: inherit;
      color: var(--text);
      background: #fff;
    }
    .search-status {
      margin: 10px 0 0;
      color: var(--muted);
      font-size: 0.95rem;
    }
    section {
      margin-top: 28px;
    }
    h2 {
      margin: 0 0 12px;
      font-size: 1.25rem;
    }
    .entry {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 16px;
      margin-bottom: 12px;
      box-shadow: 0 10px 30px rgba(18, 32, 51, 0.06);
    }
    .entry[hidden] {
      display: none;
    }
    .entry-top {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: baseline;
      flex-wrap: wrap;
    }
    .entry-top h3 {
      margin: 0;
      font-size: 1.1rem;
    }
    .entry-top a {
      color: var(--accent);
      text-decoration: none;
    }
    .entry-top a:hover {
      text-decoration: underline;
    }
    .timestamp {
      color: var(--muted);
    }
    .chips {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 10px;
    }
    .chip {
      background: var(--accent-soft);
      color: var(--accent);
      border-radius: 999px;
      padding: 4px 10px;
      font-size: 0.85rem;
      font-weight: 600;
    }
    .chip-type {
      background: #eef6ea;
      color: #2f6d2a;
    }
    .chip-list-favorite {
      background: #fff3cd;
      color: #8a5a00;
    }
    .chip-list-study {
      background: #e5f6ea;
      color: #1d6f3b;
    }
    blockquote {
      margin: 12px 0 0;
      padding: 12px 14px;
      border-left: 4px solid var(--accent);
      background: #f8faff;
      border-radius: 10px;
      color: #243447;
    }
    .note {
      margin: 12px 0 0;
      color: #243447;
    }
    .empty {
      background: var(--card);
      border: 1px dashed var(--border);
      border-radius: 16px;
      padding: 18px;
      color: var(--muted);
    }
    #search-empty[hidden] {
      display: none;
    }
    @media (max-width: 640px) {
      body {
        padding: 20px 12px 40px;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>LODVault Export</h1>
      <p class="meta">Exported ${escapeHtml(exportedAt)} · ${entries.length} saved word${entries.length === 1 ? "" : "s"}</p>
      <div class="search-panel">
        <input id="search-input" class="search-input" type="search" placeholder="Search words, type, translation, example, note..." autocomplete="off">
        <p id="search-status" class="search-status">${entries.length} saved word${entries.length === 1 ? "" : "s"}</p>
      </div>
    </header>

    <div id="search-empty" class="empty" hidden>No matching words found.</div>

    <section>
      <h2>Favorites (${favorites.length})</h2>
      ${favorites.length ? favorites.map((entry) => buildEntryMarkup(entry, "favorite")).join("") : '<div class="empty">No favorite words yet.</div>'}
    </section>

    <section>
      <h2>Study List (${study.length})</h2>
      ${study.length ? study.map((entry) => buildEntryMarkup(entry, "study")).join("") : '<div class="empty">No study words yet.</div>'}
    </section>
  </main>
  ${includeInlineScript ? buildExportSearchScriptTag() : ""}
</body>
</html>`;
  }

  globalThis.LodWrapperStore = {
    STORAGE_KEY,
    getIdFromUrl,
    normalizeEntry,
    getEntries,
    getEntry,
    toggleList,
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
