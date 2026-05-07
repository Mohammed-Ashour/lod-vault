const frame = document.getElementById("preview-frame");
const meta = document.getElementById("preview-meta");
const flashcardsButton = document.getElementById("open-flashcards");
const refreshButton = document.getElementById("refresh-preview");
const downloadButton = document.getElementById("download-html");
let currentPreviewUrl = "";
let currentSearchQuery = "";
let currentLang = "";
let currentSort = "recent";
let applyPreviewFilters = () => {};

const langNames = LodWrapperStore.TRANSLATION_LANGUAGE_LABELS;
const langOrder = LodWrapperStore.TRANSLATION_LANGUAGE_ORDER;

refreshButton.addEventListener("click", renderPreview);
flashcardsButton?.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("pages/flashcards.html") });
});
downloadButton.addEventListener("click", downloadHtml);
document.getElementById("lang-filter").addEventListener("change", (e) => {
  currentLang = e.target.value;
  applyLangFilter();
});

document.getElementById("sort-order").addEventListener("change", (e) => {
  currentSort = e.target.value;
  renderPreview();
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
      align-items: center;
      gap: 6px;
    }
    .preview-toggle-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 5px 11px;
      font-size: 12.5px;
      font-weight: 700;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 999px;
      color: #5f8fa8;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }
    .preview-toggle-pill:disabled {
      opacity: 0.5;
      cursor: wait;
    }
    .preview-toggle-pill:hover:enabled {
      background: rgba(255,255,255,0.1);
      border-color: rgba(255,255,255,0.22);
      color: #ddeef5;
    }
    .preview-toggle-pill-icon {
      font-size: 13px;
      line-height: 1;
    }
    .preview-toggle-pill-label {
      text-transform: none;
      letter-spacing: 0;
    }
    .preview-toggle-pill.is-fav {
      background: rgba(230,197,96,0.15);
      border-color: rgba(230,197,96,0.4);
      color: #e6c560;
    }
    .preview-toggle-pill.is-fav:hover:enabled {
      background: rgba(230,197,96,0.25);
      border-color: rgba(230,197,96,0.55);
      color: #f0d56e;
    }
    .preview-toggle-pill.is-study {
      background: rgba(57,167,196,0.15);
      border-color: rgba(57,167,196,0.4);
      color: #a8dadc;
    }
    .preview-toggle-pill.is-study:hover:enabled {
      background: rgba(57,167,196,0.25);
      border-color: rgba(57,167,196,0.55);
      color: #a8dadc;
    }
    .preview-delete-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      padding: 0;
      margin-left: auto;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 7px;
      color: #5f8fa8;
      font-size: 16px;
      font-weight: 300;
      line-height: 1;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }
    .preview-delete-btn:hover {
      background: rgba(230,57,70,0.1);
      border-color: rgba(230,57,70,0.3);
      color: #e63946;
    }
    .preview-delete-btn:disabled {
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

/* ── toggle pills & delete ──────────────────────── */

async function handlePreviewToggle(id, listName) {
  const savedEntry = await LodWrapperStore.getEntry(id);
  if (!savedEntry) return;
  await LodWrapperStore.toggleList(savedEntry, listName);
}

function attachRemoveButtons(doc) {
  for (const entryElement of doc.querySelectorAll(".entry[data-id][data-lists]")) {
    if (entryElement.querySelector(".preview-entry-actions")) continue;

    const id = entryElement.dataset.id;
    const lists = (entryElement.dataset.lists || "").split(",").filter(Boolean);

    const actions = doc.createElement("div");
    actions.className = "preview-entry-actions";

    /* Favorite toggle */
    const isFav = lists.includes("favorite");
    const favBtn = doc.createElement("button");
    favBtn.type = "button";
    favBtn.className = "preview-toggle-pill" + (isFav ? " is-fav" : "");
    favBtn.title = isFav ? "Remove from favorites" : "Add to favorites";
    favBtn.innerHTML = '<span class="preview-toggle-pill-icon">' + (isFav ? "★" : "☆") + '</span><span class="preview-toggle-pill-label">Fav</span>';
    favBtn.addEventListener("click", async () => {
      favBtn.disabled = true;
      try {
        await handlePreviewToggle(id, "favorite");
        await renderPreview();
      } finally {
        favBtn.disabled = false;
      }
    });
    actions.appendChild(favBtn);

    /* Study toggle */
    const isStudy = lists.includes("study");
    const studyBtn = doc.createElement("button");
    studyBtn.type = "button";
    studyBtn.className = "preview-toggle-pill" + (isStudy ? " is-study" : "");
    studyBtn.title = isStudy ? "Remove from study list" : "Add to study list";
    studyBtn.innerHTML = '<span class="preview-toggle-pill-icon">' + (isStudy ? "●" : "○") + '</span><span class="preview-toggle-pill-label">Study</span>';
    studyBtn.addEventListener("click", async () => {
      studyBtn.disabled = true;
      try {
        await handlePreviewToggle(id, "study");
        await renderPreview();
      } finally {
        studyBtn.disabled = false;
      }
    });
    actions.appendChild(studyBtn);

    /* Delete button */
    const delBtn = doc.createElement("button");
    delBtn.type = "button";
    delBtn.className = "preview-delete-btn";
    delBtn.title = "Remove saved word";
    delBtn.textContent = "×";
    delBtn.addEventListener("click", async () => {
      delBtn.disabled = true;
      try {
        await LodWrapperStore.removeEntry(id);
        await renderPreview();
      } finally {
        delBtn.disabled = false;
      }
    });
    actions.appendChild(delBtn);

    entryElement.appendChild(actions);
  }
}

/* ── render ──────────────────────────────────────── */

function sortEntries(entries, sortMode) {
  const sorted = [...entries];
  if (sortMode === "visited") {
    sorted.sort((a, b) => {
      const aVisits = Number(a.visitCount) || 0;
      const bVisits = Number(b.visitCount) || 0;
      if (bVisits !== aVisits) return bVisits - aVisits;
      const aTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
      const bTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
      return aTime - bTime;
    });
  } else if (sortMode === "alpha") {
    sorted.sort((a, b) => (a.word || "").localeCompare(b.word || "", undefined, { sensitivity: "base" }));
  } else if (sortMode === "oldest") {
    sorted.sort((a, b) => {
      const aTime = new Date(a.createdAt || a.updatedAt || 0).getTime();
      const bTime = new Date(b.createdAt || b.updatedAt || 0).getTime();
      return aTime - bTime;
    });
  }
  return sorted;
}

async function renderPreview() {
  let entries = await LodWrapperStore.getEntries();
  entries = sortEntries(entries, currentSort);
  populateLangSelect(entries);

  const html = LodWrapperStore.buildExportHtml(entries, { includeInlineScript: false });
  const count = `${entries.length} saved word${entries.length === 1 ? "" : "s"}`;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);

  if (currentPreviewUrl) {
    URL.revokeObjectURL(currentPreviewUrl);
  }

  currentPreviewUrl = url;
  meta.textContent = `${count} · live vault from local extension storage`;
  frame.onload = () => {
    applyPreviewFilters = () => {};
    attachPreviewSearch();
  };
  frame.src = url;
}

async function downloadHtml() {
  let entries = await LodWrapperStore.getEntries();
  entries = sortEntries(entries, currentSort);
  const html = LodWrapperStore.buildExportHtml(entries);
  const date = new Date().toISOString().slice(0, 10);
  LodWrapperStore.downloadTextFile(`lodvault-export-${date}.html`, html, "text/html");
}

window.addEventListener("beforeunload", () => {
  if (currentPreviewUrl) {
    URL.revokeObjectURL(currentPreviewUrl);
  }
});
