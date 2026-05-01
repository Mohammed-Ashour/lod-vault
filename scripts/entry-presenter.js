(() => {
  const store = globalThis.LodWrapperStoreCore || globalThis.LodWrapperStore || {};
  const TRANSLATION_LANGUAGE_ORDER = store.TRANSLATION_LANGUAGE_ORDER || ["en", "fr", "de", "pt", "nl"];
  const TRANSLATION_LANGUAGE_LABELS = store.TRANSLATION_LANGUAGE_LABELS || {
    en: "English",
    fr: "Français",
    de: "Deutsch",
    pt: "Português",
    nl: "Nederlands"
  };
  const TRANSLATION_LANGUAGE_CHIP_LABELS = store.TRANSLATION_LANGUAGE_CHIP_LABELS || {
    en: "EN",
    fr: "FR",
    de: "DE",
    pt: "PT",
    nl: "NL"
  };
  const normalizeEntry = typeof store.normalizeEntry === "function"
    ? store.normalizeEntry
    : (entry) => entry || {};
  const normalizeVisitCount = typeof store.normalizeVisitCount === "function"
    ? store.normalizeVisitCount
    : (value) => Number(value) > 0 ? Math.floor(Number(value)) : 0;

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

  function buildSearchText(entry) {
    const normalized = normalizeEntry(entry);
    return [
      normalized.word,
      normalized.pos,
      normalized.inflection,
      normalized.example,
      normalized.note,
      ...Object.values(normalized.translations || {})
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function getMeaningItems(entry) {
    const normalized = normalizeEntry(entry);
    return TRANSLATION_LANGUAGE_ORDER
      .filter((lang) => normalized?.translations?.[lang])
      .map((lang) => ({
        lang,
        label: TRANSLATION_LANGUAGE_LABELS[lang] || lang.toUpperCase(),
        chipLabel: TRANSLATION_LANGUAGE_CHIP_LABELS[lang] || lang.toUpperCase(),
        value: normalized.translations[lang]
      }));
  }

  function buildMeaningText(entry) {
    return getMeaningItems(entry)
      .map((item) => `${item.label}: ${item.value}`)
      .join(" · ");
  }

  function buildMeaningChipsMarkup(entry, className = "meaning-chip") {
    return getMeaningItems(entry)
      .map((item) => `<span class="${escapeHtml(className)}">${escapeHtml(`${item.label}: ${item.value}`)}</span>`)
      .join("");
  }

  function buildMeaningRowsMarkup(entry, options = {}) {
    const rowClass = options.rowClass || "meaning-row";
    const labelClass = options.labelClass || "meaning-label";
    const valueClass = options.valueClass || "meaning-value";

    return getMeaningItems(entry)
      .map((item) => `
        <div class="${escapeHtml(rowClass)}">
          <span class="${escapeHtml(labelClass)}">${escapeHtml(item.label)}</span>
          <span class="${escapeHtml(valueClass)}">${escapeHtml(item.value)}</span>
        </div>
      `)
      .join("");
  }

  function getPrimaryMeaning(entry, preferredLanguages = ["en", "fr", "de"]) {
    const normalized = normalizeEntry(entry);
    for (const lang of preferredLanguages) {
      if (normalized?.translations?.[lang]) {
        return {
          lang,
          label: TRANSLATION_LANGUAGE_LABELS[lang] || lang.toUpperCase(),
          value: normalized.translations[lang]
        };
      }
    }

    const [first] = getMeaningItems(normalized);
    return first || null;
  }

  function buildVisitMeta(entry) {
    const normalized = normalizeEntry(entry);
    if (!normalized.history) return "";

    const parts = [];
    const visitCount = normalizeVisitCount(normalized.visitCount) || 1;
    parts.push(`Visited ${visitCount} time${visitCount === 1 ? "" : "s"}`);
    if (normalized.lastVisitedAt) {
      parts.push(`Last visited ${formatWhen(normalized.lastVisitedAt)}`);
    }

    return parts.join(" · ");
  }

  function buildEntryMarkup(entry) {
    const normalized = normalizeEntry(entry);
    const chips = [];
    const activeLists = [];
    if (normalized.favorite) activeLists.push("favorite");
    if (normalized.study) activeLists.push("study");
    if (normalized.history) activeLists.push("history");

    if (normalized.pos) {
      chips.push(`<span class="chip chip-type">${escapeHtml(normalized.pos)}</span>`);
    }

    if (normalized.favorite) chips.push('<span class="chip chip-list-favorite">Favorite</span>');
    if (normalized.study) chips.push('<span class="chip chip-list-study">Study</span>');
    if (normalized.history) chips.push('<span class="chip chip-list-history">History</span>');

    for (const item of getMeaningItems(normalized)) {
      chips.push(`<span class="chip" data-lang="${item.lang}">${escapeHtml(`${item.chipLabel}: ${item.value}`)}</span>`);
    }

    const translationLanguages = getMeaningItems(normalized).map((item) => item.lang);

    return `
      <article class="entry" data-id="${escapeHtml(normalized.id)}" data-lists="${escapeHtml(activeLists.join(","))}" data-langs="${escapeHtml(translationLanguages.join(","))}" data-search="${escapeHtml(buildSearchText(normalized))}">
        <div class="entry-top">
          <h3><a href="${escapeHtml(normalized.url)}" target="_blank" rel="noreferrer">${escapeHtml(normalized.word)}</a></h3>
          <span class="timestamp">${escapeHtml(formatWhen(normalized.updatedAt || normalized.lastVisitedAt || normalized.createdAt))}</span>
        </div>
        ${chips.length ? `<div class="chips">${chips.join("")}</div>` : ""}
        ${buildVisitMeta(normalized) ? `<p class="visit-meta">${escapeHtml(buildVisitMeta(normalized))}</p>` : ""}
        ${normalized.inflection ? `<p class="detail"><strong>Inflection:</strong> ${escapeHtml(normalized.inflection)}</p>` : ""}
        ${normalized.example ? `<blockquote>${escapeHtml(normalized.example)}</blockquote>` : ""}
        ${normalized.note ? `<p class="note"><strong>Note:</strong> ${escapeHtml(normalized.note)}</p>` : ""}
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
    const exportedAt = formatWhen(new Date().toISOString());

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

  function downloadTextFile(filename, content, mimeType = "text/plain") {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    link.click();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  globalThis.LodWrapperEntryPresenter = {
    escapeHtml,
    formatWhen,
    buildSearchText,
    getMeaningItems,
    buildMeaningText,
    buildMeaningChipsMarkup,
    buildMeaningRowsMarkup,
    getPrimaryMeaning,
    buildVisitMeta,
    buildEntryMarkup,
    buildExportHtml,
    downloadTextFile
  };
})();
