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

  function getAudioUrl(entry) {
    const id = (entry && (entry.id || entry.lod_id) || "").toLowerCase();
    if (!id) return null;
    return `https://lod.lu/uploads/OGG/${id}.ogg`;
  }

  function createAudioController(doc) {
    doc = doc || globalThis.document;
    if (!doc) {
      return { play() {}, stopAll() {} };
    }
    const cache = new Map();

    function stopAll() {
      for (const [, audio] of cache) {
        audio.pause();
        audio.currentTime = 0;
      }
      doc.querySelectorAll(".audio-btn.is-playing").forEach((b) => b.classList.remove("is-playing"));
      cache.clear();
    }

    function play(url, buttonOrId) {
      let btn;
      if (typeof buttonOrId === "string") {
        btn = doc.querySelector(`[data-audio-id="${CSS.escape(buttonOrId)}"]`);
      } else if (buttonOrId instanceof Element) {
        btn = buttonOrId;
      }

      let audio = cache.get(url);
      if (audio && !audio.paused) {
        audio.pause();
        audio.currentTime = 0;
        cache.delete(url);
        if (btn) btn.classList.remove("is-playing");
        return;
      }

      stopAll();

      audio = new Audio(url);
      cache.set(url, audio);

      audio.addEventListener("play", () => { if (btn) btn.classList.add("is-playing"); });
      audio.addEventListener("ended", () => {
        if (btn) btn.classList.remove("is-playing");
        cache.delete(url);
      });
      audio.addEventListener("error", () => {
        if (btn) {
          btn.classList.remove("is-playing");
          btn.classList.add("is-error");
        }
        cache.delete(url);
      });

      audio.play().catch(() => {
        if (btn) btn.classList.remove("is-playing");
        cache.delete(url);
      });
    }

    return { play, stopAll };
  }

  const defaultAudioController = createAudioController();

  function playLodAudio(entry, options = {}) {
    const url = getAudioUrl(entry);
    if (!url) return;
    const ctrl = options.controller || defaultAudioController;
    ctrl.play(url, entry.id || entry.lod_id || "");
  }

  function buildAudioBtnMarkup(entry, options = {}) {
    const id = (entry && (entry.id || entry.lod_id) || "").trim();
    if (!id) return "";
    const cssClass = options.cssClass || "audio-btn";
    const label = options.label || "Play pronunciation";
    return `<button type="button" class="${escapeHtml(cssClass)}" data-audio-id="${escapeHtml(id)}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg></button>`;
  }

  function getAudioBtnCss(options = {}) {
    const selector = options.selector || ".audio-btn";
    return `
    ${selector} {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      padding: 0;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.05);
      color: #5f8fa8;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, color 0.15s, transform 0.1s;
      flex-shrink: 0;
      line-height: 1;
    }
    ${selector}:hover {
      background: rgba(57, 167, 196, 0.15);
      border-color: rgba(57, 167, 196, 0.4);
      color: #a8dadc;
      transform: scale(1.08);
    }
    ${selector}:active {
      transform: scale(0.95);
    }
    ${selector} svg {
      width: 14px;
      height: 14px;
    }
    ${selector}.is-playing {
      background: rgba(57, 167, 196, 0.2);
      border-color: rgba(57, 167, 196, 0.5);
      color: #39a7c4;
      animation: audio-pulse 1s ease-in-out infinite;
    }
    ${selector}.is-error {
      background: rgba(230, 57, 70, 0.1);
      border-color: rgba(230, 57, 70, 0.3);
      color: #e63946;
    }
    @keyframes audio-pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.1); }
    }`;
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

  function buildMeaningCollapsibleMarkup(entry, options = {}) {
    const items = getMeaningItems(entry);
    if (!items.length) return "";

    const toggleClass = options.toggleClass || "meaning-toggle";
    const panelClass = options.panelClass || "meaning-expand";
    const rowClass = options.rowClass || "meaning-row";
    const labelClass = options.labelClass || "meaning-label";
    const valueClass = options.valueClass || "meaning-value";

    const count = items.length;
    const countLabel = `${count} translation${count === 1 ? "" : "s"}`;

    const primaryText = items[0] ? `${items[0].chipLabel}: ${items[0].value}` : "";

    const rows = items.map((item) =>
      `<div class="${escapeHtml(rowClass)}">`
      + `<span class="${escapeHtml(labelClass)}" data-lang="${escapeHtml(item.lang)}">${escapeHtml(item.chipLabel)}</span>`
      + `<span class="${escapeHtml(valueClass)}">${escapeHtml(item.value)}</span>`
      + `</div>`
    ).join("");

    return `<button type="button" class="${escapeHtml(toggleClass)}" aria-expanded="false">`
      + `<span class="meaning-toggle-arrow">&#x25B6;</span>`
      + `<span class="meaning-toggle-text">${escapeHtml(primaryText)}</span>`
      + `<span class="meaning-toggle-count">${escapeHtml(countLabel)}</span>`
      + `</button>`
      + `<div class="${escapeHtml(panelClass)}">${rows}</div>`;
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

    const translationsMarkup = buildMeaningCollapsibleMarkup(normalized, {
      toggleClass: "meaning-toggle",
      panelClass: "meaning-expand",
      rowClass: "meaning-row",
      labelClass: "meaning-label",
      valueClass: "meaning-value"
    });

    const translationLanguages = getMeaningItems(normalized).map((item) => item.lang);

    const audioBtn = buildAudioBtnMarkup(normalized);

    return `
      <article class="entry" data-id="${escapeHtml(normalized.id)}" data-lists="${escapeHtml(activeLists.join(","))}" data-langs="${escapeHtml(translationLanguages.join(","))}" data-search="${escapeHtml(buildSearchText(normalized))}">
        <div class="entry-top">
          <h3>${audioBtn ? "<span class=\"entry-top-word\">" : ""}<a href="${escapeHtml(normalized.url)}" target="_blank" rel="noreferrer">${escapeHtml(normalized.word)}</a>${audioBtn ? "</span>" : ""}${audioBtn}</h3>
          <span class="timestamp">${escapeHtml(formatWhen(normalized.updatedAt || normalized.lastVisitedAt || normalized.createdAt))}</span>
        </div>
        ${chips.length ? `<div class="chips">${chips.join("")}</div>` : ""}
        ${translationsMarkup}
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
    function createAudioController(doc) {
      const cache = new Map();
      function stopAll() {
        for (const [, a] of cache) { a.pause(); a.currentTime = 0; }
        doc.querySelectorAll('.audio-btn.is-playing').forEach(b => b.classList.remove('is-playing'));
        cache.clear();
      }
      function play(url, btn) {
        let audio = cache.get(url);
        if (audio && !audio.paused) {
          audio.pause(); audio.currentTime = 0; cache.delete(url);
          btn.classList.remove('is-playing');
          return;
        }
        stopAll();
        audio = new Audio(url);
        cache.set(url, audio);
        audio.addEventListener('play', () => btn.classList.add('is-playing'));
        audio.addEventListener('ended', () => { btn.classList.remove('is-playing'); cache.delete(url); });
        audio.addEventListener('error', () => { btn.classList.remove('is-playing'); btn.classList.add('is-error'); cache.delete(url); });
        audio.play().catch(() => { btn.classList.remove('is-playing'); cache.delete(url); });
      }
      return { play, stopAll };
    }
    const audioController = createAudioController(document);

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

    function handleAudioClick(event) {
      const btn = event.target.closest('.audio-btn');
      if (!btn) return;
      event.preventDefault();
      event.stopPropagation();
      const id = btn.dataset.audioId;
      if (!id) return;
      const url = 'https://lod.lu/uploads/OGG/' + id.toLowerCase() + '.ogg';
      audioController.play(url, btn);
    }

    function handleToggleClick(event) {
      const toggle = event.target.closest('.meaning-toggle');
      if (!toggle) return;
      const isOpen = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
      const panel = toggle.nextElementSibling;
      if (panel && panel.classList.contains('meaning-expand')) {
        panel.classList.toggle('is-open', !isOpen);
      }
    }

    input.addEventListener('input', applySearch);
    document.addEventListener('click', handleAudioClick);
    document.addEventListener('click', handleToggleClick);
    applySearch();
  <\/script>`;
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
    .entry-top h3 {
      font-size: 1rem; font-weight: 700; color: #fff;
      display: flex; align-items: center; gap: 8px;
    }
    .entry-top a { color: var(--teal-lt); text-decoration: none; }
    .entry-top a:hover { text-decoration: underline; }
    .entry-top .entry-top-word { display: inline-flex; align-items: center; gap: 8px; }
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
    .meaning-toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
      padding: 4px 10px;
      font-size: 11.5px;
      font-weight: 600;
      font-family: inherit;
      background: rgba(57,167,196,0.08);
      border: 1px solid rgba(57,167,196,0.18);
      border-radius: 999px;
      color: var(--teal-lt);
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }
    .meaning-toggle:hover { background: rgba(57,167,196,0.16); }
    .meaning-toggle-arrow {
      font-size: 9px;
      transition: transform 0.2s;
    }
    .meaning-toggle[aria-expanded="true"] .meaning-toggle-arrow { transform: rotate(90deg); }
    .meaning-toggle-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 200px;
    }
    .meaning-toggle-count {
      font-size: 10px;
      opacity: 0.7;
      margin-left: 2px;
    }
    .meaning-expand {
      display: none;
      margin-top: 6px;
      padding: 8px 12px;
      background: rgba(57,167,196,0.05);
      border: 1px solid rgba(57,167,196,0.12);
      border-radius: 6px;
    }
    .meaning-expand.is-open { display: block; }
    .meaning-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
      padding: 3px 0;
    }
    .meaning-row + .meaning-row { border-top: 1px solid var(--border); padding-top: 5px; }
    .meaning-label {
      flex-shrink: 0;
      min-width: 26px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      text-align: left;
      line-height: 1.35;
      color: var(--teal-lt);
    }
    .meaning-label[data-lang="en"] { color: #7dd4a8; }
    .meaning-label[data-lang="fr"] { color: #f2a3aa; }
    .meaning-label[data-lang="de"] { color: #f0d56e; }
    .meaning-label[data-lang="pt"] { color: #c4a8f0; }
    .meaning-label[data-lang="nl"] { color: #f0a86e; }
    .meaning-value {
      font-size: 12.5px;
      color: var(--text);
      line-height: 1.35;
      min-width: 0;
    }
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
    .audio-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; padding: 0;
      border: 1px solid rgba(255,255,255,0.12); border-radius: 50%;
      background: rgba(255,255,255,0.05); color: var(--muted); cursor: pointer;
      transition: background 0.15s, border-color 0.15s, color 0.15s, transform 0.1s;
      flex-shrink: 0; line-height: 1;
    }
    .audio-btn:hover {
      background: rgba(57,167,196,0.15); border-color: rgba(57,167,196,0.4); color: var(--teal-lt); transform: scale(1.08);
    }
    .audio-btn:active { transform: scale(0.95); }
    .audio-btn svg { width: 14px; height: 14px; }
    .audio-btn.is-playing {
      background: rgba(57,167,196,0.2); border-color: rgba(57,167,196,0.5); color: var(--teal);
      animation: audio-pulse 1s ease-in-out infinite;
    }
    .audio-btn.is-error { background: rgba(230,57,70,0.1); border-color: rgba(230,57,70,0.3); color: #e63946; }
    @keyframes audio-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.1)} }
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

  function buildAnkiExport(entries) {
    const normalized = entries.map(normalizeEntry).filter((e) => e.word);
    const lines = [
      "#separator:Tab",
      "#html:true",
      "#deck:LODVault",
      "#columns:Word\tPOS\tTranslations\tInflection\tExample\tNote\tURL"
    ];

    for (const entry of normalized) {
      const items = getMeaningItems(entry);
      const translationsHtml = items.length
        ? items.map((i) => `<div><b>${escapeHtml(i.label)}</b>: ${escapeHtml(i.value)}</div>`).join("")
        : "";
      const inflection = entry.inflection ? escapeHtml(entry.inflection) : "";
      const example = entry.example ? escapeHtml(entry.example) : "";
      const note = entry.note ? escapeHtml(entry.note) : "";
      const url = entry.url ? escapeHtml(entry.url) : "";

      lines.push([
        escapeHtml(entry.word),
        escapeHtml(entry.pos),
        translationsHtml,
        inflection,
        example,
        note,
        url
      ].join("\t"));
    }

    return lines.join("\n");
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
    buildMeaningText,
    buildMeaningChipsMarkup,
    buildMeaningRowsMarkup,
    buildMeaningCollapsibleMarkup,
    getPrimaryMeaning,
    getAudioUrl,
    createAudioController,
    playLodAudio,
    buildAudioBtnMarkup,
    getAudioBtnCss,
    buildExportHtml,
    buildAnkiExport,
    downloadTextFile
  };
})();
