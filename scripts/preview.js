const frame = document.getElementById("preview-frame");
const meta = document.getElementById("preview-meta");
const refreshButton = document.getElementById("refresh-preview");
const downloadButton = document.getElementById("download-html");
let currentPreviewUrl = "";
let currentSearchQuery = "";
let currentLang = "";
let applyPreviewFilters = () => {};

const langNames = LodWrapperStore.TRANSLATION_LANGUAGE_LABELS;
const langOrder = LodWrapperStore.TRANSLATION_LANGUAGE_ORDER;

refreshButton.addEventListener("click", renderPreview);
downloadButton.addEventListener("click", downloadHtml);
document.getElementById("lang-filter").addEventListener("change", (e) => {
  currentLang = e.target.value;
  applyLangFilter();
});

document.addEventListener("DOMContentLoaded", renderPreview);

/* ── language filter ─────────────────────────────── */

function applyLangFilter() {
  const doc = frame.contentDocument;
  if (!doc) return;

  let style = doc.getElementById("lodvault-lang-style");
  if (!style) {
    style = doc.createElement("style");
    style.id = "lodvault-lang-style";
    doc.head.appendChild(style);
  }

  style.textContent = currentLang
    ? `.chip[data-lang]:not([data-lang="${currentLang}"]) { display: none !important; }`
    : "";

  applyPreviewFilters();
}

function populateLangSelect(entries) {
  const present = new Set();
  for (const entry of entries) {
    for (const lang of Object.keys(entry.translations || {})) {
      if (langNames[lang]) present.add(lang);
    }
  }

  const select = document.getElementById("lang-filter");
  const previous = select.value;

  select.innerHTML = "<option value=\"\">All languages</option>";
  for (const lang of langOrder) {
    if (!present.has(lang)) continue;
    const opt = document.createElement("option");
    opt.value = lang;
    opt.textContent = langNames[lang];
    select.appendChild(opt);
  }

  select.value = present.has(previous) ? previous : "";
  currentLang = select.value;
}

/* ── preview styles ──────────────────────────────── */

function injectPreviewStyles(doc) {
  if (doc.getElementById("lod-wrapper-preview-style")) return;

  const style = doc.createElement("style");
  style.id = "lod-wrapper-preview-style";
  style.textContent = `
    .preview-entry-actions {
      margin-top: 12px;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .preview-remove-button {
      border: 1px solid rgba(230,57,70,0.25);
      background: rgba(230,57,70,0.08);
      color: #f08088;
      border-radius: 7px;
      padding: 6px 12px;
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }
    .preview-remove-button:hover {
      background: rgba(230,57,70,0.18);
      border-color: rgba(230,57,70,0.5);
      color: #ff8890;
    }
    .preview-remove-button:disabled {
      opacity: 0.5;
      cursor: wait;
    }
  `;
  doc.head.appendChild(style);
}

/* ── search ──────────────────────────────────────── */

function attachPreviewSearch() {
  const doc = frame.contentDocument;
  if (!doc) return;

  injectPreviewStyles(doc);

  const input = doc.getElementById("search-input");
  const status = doc.getElementById("search-status");
  const empty = doc.getElementById("search-empty");
  const entries = Array.from(doc.querySelectorAll(".entry"));
  if (!input || !status || !empty) return;

  applyPreviewFilters = () => {
    const query = (input.value || "").trim().toLowerCase();
    currentSearchQuery = input.value || "";
    let visibleCount = 0;

    for (const entry of entries) {
      const matchesQuery = !query || (entry.dataset.search || "").includes(query);
      const languages = (entry.dataset.langs || "").split(",").filter(Boolean);
      const matchesLanguage = !currentLang || languages.includes(currentLang);
      const match = matchesQuery && matchesLanguage;

      entry.hidden = !match;
      if (match) visibleCount += 1;
    }

    const activeFilters = [query ? "search" : "", currentLang ? "language" : ""].filter(Boolean).length;
    status.textContent = activeFilters
      ? `${visibleCount} matching word${visibleCount === 1 ? "" : "s"}`
      : `${entries.length} saved word${entries.length === 1 ? "" : "s"}`;
    empty.hidden = visibleCount !== 0 || activeFilters === 0;
  };

  input.value = currentSearchQuery;
  input.addEventListener("input", applyPreviewFilters);
  attachRemoveButtons(doc);
  applyLangFilter();
  applyPreviewFilters();
}

/* ── remove buttons ──────────────────────────────── */

function previewRemoveLabel(listName) {
  if (listName === "favorite") return "Remove from favorites";
  if (listName === "study") return "Remove from study list";
  return "Remove from history";
}

async function handlePreviewRemove(id, listName) {
  const savedEntry = await LodWrapperStore.getEntry(id);
  if (!savedEntry) return;

  if (listName === "history") {
    await LodWrapperStore.removeFromHistory(id);
    return;
  }

  await LodWrapperStore.toggleList(savedEntry, listName);
}

function attachRemoveButtons(doc) {
  for (const entryElement of doc.querySelectorAll(".entry[data-id][data-lists]")) {
    if (entryElement.querySelector(".preview-entry-actions")) continue;

    const lists = (entryElement.dataset.lists || "").split(",").filter(Boolean);
    if (!lists.length) continue;

    const actions = doc.createElement("div");
    actions.className = "preview-entry-actions";

    for (const listName of lists) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "preview-remove-button";
      button.textContent = previewRemoveLabel(listName);
      button.dataset.list = listName;

      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await handlePreviewRemove(entryElement.dataset.id, listName);
          await renderPreview();
        } finally {
          button.disabled = false;
        }
      });

      actions.appendChild(button);
    }

    entryElement.appendChild(actions);
  }
}

/* ── render ──────────────────────────────────────── */

async function renderPreview() {
  const entries = await LodWrapperStore.getEntries();
  populateLangSelect(entries);

  const html = LodWrapperStore.buildExportHtml(entries, { includeInlineScript: false });
  const count = `${entries.length} saved word${entries.length === 1 ? "" : "s"}`;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);

  if (currentPreviewUrl) {
    URL.revokeObjectURL(currentPreviewUrl);
  }

  currentPreviewUrl = url;
  meta.textContent = `${count} · live preview from local extension storage`;
  frame.onload = () => {
    applyPreviewFilters = () => {};
    attachPreviewSearch();
  };
  frame.src = url;
}

async function downloadHtml() {
  const entries = await LodWrapperStore.getEntries();
  const html = LodWrapperStore.buildExportHtml(entries);
  const date = new Date().toISOString().slice(0, 10);
  LodWrapperStore.downloadTextFile(`lodvault-export-${date}.html`, html, "text/html");
}

window.addEventListener("beforeunload", () => {
  if (currentPreviewUrl) {
    URL.revokeObjectURL(currentPreviewUrl);
  }
});
