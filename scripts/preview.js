const frame = document.getElementById("preview-frame");
const meta = document.getElementById("preview-meta");
const flashcardsButton = document.getElementById("open-flashcards");
const refreshButton = document.getElementById("refresh-preview");
const downloadButton = document.getElementById("download-html");
const downloadAnkiButton = document.getElementById("download-anki");
let currentPreviewUrl = "";
let currentSearchQuery = "";
let currentLang = "";
let currentSort = "recent";
let applyPreviewFilters = () => {};
let currentEntriesById = new Map();
let pendingDeletedEntry = null;
let deleteUndoTimer = null;
let actionFeedbackTimer = null;

const langNames = LodVaultStore.TRANSLATION_LANGUAGE_LABELS;
const langOrder = LodVaultStore.TRANSLATION_LANGUAGE_ORDER;

function getPreviewActiveElement() {
  return frame.contentDocument?.activeElement || document.activeElement;
}

function showActionFeedback(message, tone = "success") {
  const feedback = document.getElementById("action-feedback");
  if (!feedback) return;
  if (actionFeedbackTimer) clearTimeout(actionFeedbackTimer);
  feedback.textContent = message;
  feedback.classList.toggle("is-error", tone === "error");
  feedback.classList.remove("is-hidden");
  actionFeedbackTimer = setTimeout(() => feedback.classList.add("is-hidden"), 5000);
}

function setPreviewNoteStatus(textarea, message, tone = "") {
  const status = textarea?.closest(".preview-note-section")?.querySelector(".preview-note-status");
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

function setPreviewNoteExpanded(section, expanded) {
  const toggle = section?.querySelector(".note-toggle");
  const noteBody = section?.querySelector(".note-body");
  if (toggle) {
    toggle.classList.toggle("is-hidden", expanded);
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  }
  if (noteBody) {
    noteBody.classList.toggle("is-hidden", !expanded);
  }
}

const previewNoteAutosave = LodVaultStore.createNoteAutosaveController({
  getTimerKey: (textarea) => `preview-note:${textarea?.dataset?.noteId || ""}`,
  getActiveElement: getPreviewActiveElement,
  setStatus: setPreviewNoteStatus,
  saveNote: (noteId, requestValue) => LodVaultStore.saveNote(noteId, requestValue),
  onSaved: async ({ textarea, savedEntry, changedSinceRequest }) => {
    if (!savedEntry?.id) return;
    currentEntriesById.set(savedEntry.id, savedEntry);

    const entryElement = textarea.closest(".entry");
    if (entryElement) {
      entryElement.dataset.search = LodVaultStore.buildSearchText(savedEntry);
    }

    const noteSection = textarea.closest(".preview-note-section");
    if (noteSection && !changedSinceRequest && !savedEntry.note && getPreviewActiveElement() !== textarea) {
      setPreviewNoteExpanded(noteSection, false);
    }

    applyPreviewFilters();
  },
  shouldKeepScheduling: (textarea) => Boolean(textarea?.isConnected)
});

refreshButton.addEventListener("click", renderPreview);
flashcardsButton?.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("pages/flashcards.html") });
});
downloadButton.addEventListener("click", downloadHtml);
downloadAnkiButton.addEventListener("click", downloadAnki);
document.getElementById("lang-filter").addEventListener("change", (e) => {
  currentLang = e.target.value;
  applyLangFilter();
});

document.getElementById("sort-order").addEventListener("change", (e) => {
  currentSort = e.target.value;
  renderPreview();
});

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("delete-undo-button").addEventListener("click", undoDelete);
  renderPreview();
});

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
  if (doc.getElementById("lodvault-preview-style")) return;

  const style = doc.createElement("style");
  style.id = "lodvault-preview-style";
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
      padding: 4px 10px;
      font-size: 11.5px;
      font-weight: 700;
      background: transparent;
      border: 1px solid rgba(168,218,220,0.16);
      border-radius: 999px;
      color: #6a8da6;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }
    .preview-toggle-pill:disabled {
      opacity: 0.5;
      cursor: wait;
    }
    .preview-toggle-pill:hover:enabled {
      border-color: rgba(79,185,212,0.5);
      color: #b8cedb;
    }
    .preview-toggle-pill-icon {
      font-size: 12px;
      line-height: 1;
    }
    .preview-toggle-pill-label {
      text-transform: none;
      letter-spacing: 0;
    }
    .preview-toggle-pill.is-fav {
      background: rgba(226,195,103,0.08);
      border-color: rgba(226,195,103,0.3);
      color: #e2c367;
    }
    .preview-toggle-pill.is-fav:hover:enabled {
      background: rgba(226,195,103,0.14);
      border-color: rgba(226,195,103,0.5);
      color: #f0d56e;
    }
    .preview-toggle-pill.is-study {
      background: rgba(57,167,196,0.1);
      border-color: rgba(57,167,196,0.3);
      color: #a8dadc;
    }
    .preview-toggle-pill.is-study:hover:enabled {
      background: rgba(57,167,196,0.16);
      border-color: rgba(57,167,196,0.5);
      color: #a8dadc;
    }
    .preview-delete-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      padding: 0;
      margin-left: auto;
      background: transparent;
      border: 0;
      border-radius: 7px;
      color: #6a8da6;
      font-size: 16px;
      font-weight: 400;
      line-height: 1;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .preview-delete-btn:hover {
      background: rgba(230,96,106,0.08);
      color: #e6606a;
    }
    .preview-delete-btn:disabled {
      opacity: 0.5;
      cursor: wait;
    }
    .preview-note-section {
      margin-top: 10px;
      border-top: 1px dashed rgba(168,218,220,0.12);
      padding-top: 8px;
    }
    .preview-note-status {
      margin-top: 4px;
      font-size: 11px;
      color: #6a8da6;
      line-height: 1.4;
    }
    .preview-note-status[data-tone="saving"],
    .preview-note-status[data-tone="success"] {
      color: #a8dadc;
    }
    .preview-note-status[data-tone="error"] {
      color: #f29ba2;
    }
    .note-toggle {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 0;
      border: none;
      background: transparent;
      color: #6a8da6;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      opacity: 0.6;
      transition: color 0.15s, opacity 0.15s;
    }
    .note-toggle:hover {
      color: #a8dadc;
      opacity: 1;
    }
    .note-toggle.is-hidden,
    .note-body.is-hidden {
      display: none;
    }
    .note-label {
      display: block;
      margin-bottom: 4px;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      color: #6a8da6;
    }
    .note-input {
      display: block;
      width: 100%;
      min-height: 62px;
      padding: 8px 10px;
      border: 1px solid rgba(168,218,220,0.16);
      border-radius: 8px;
      background: #111d2e;
      color: #e4eef4;
      font: inherit;
      font-size: 12.5px;
      line-height: 1.45;
      resize: vertical;
    }
    .note-input::placeholder {
      color: #6a8da6;
      opacity: 1;
    }
    .note-input:focus {
      outline: none;
      border-color: #39a7c4;
      box-shadow: 0 0 0 3px rgba(57,167,196,0.18);
    }
    .audio-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      padding: 0;
      border: 1px solid rgba(168,218,220,0.16);
      border-radius: 50%;
      background: #111d2e;
      color: #6a8da6;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, color 0.15s, transform 0.1s;
      flex-shrink: 0;
      line-height: 1;
    }
    .audio-btn:hover {
      background: rgba(57,167,196,0.12);
      border-color: rgba(57,167,196,0.35);
      color: #a8dadc;
      transform: scale(1.08);
    }
    .audio-btn:active { transform: scale(0.95); }
    .audio-btn svg { width: 14px; height: 14px; }
    .audio-btn.is-playing {
      background: rgba(57,167,196,0.15);
      border-color: rgba(57,167,196,0.45);
      color: #39a7c4;
      animation: audio-pulse 1s ease-in-out infinite;
    }
    .audio-btn.is-error {
      background: rgba(230,96,106,0.08);
      border-color: rgba(230,96,106,0.3);
      color: #e6606a;
    }
    @keyframes audio-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.1)} }
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
  attachPreviewNoteEditors(doc);
  attachRemoveButtons(doc);
  attachAudioButtons(doc);
  attachMeaningToggles(doc);
  applyLangFilter();
  applyPreviewFilters();
}

/* ── toggle pills & delete ──────────────────────── */

async function handlePreviewToggle(id, listName) {
  const savedEntry = await LodVaultStore.getEntry(id);
  if (!savedEntry) return;
  const updatedEntry = await LodVaultStore.toggleList(savedEntry, listName);
  showActionFeedback(typeof LodVaultStore.describeListAction === "function"
    ? LodVaultStore.describeListAction(savedEntry, listName, updatedEntry)
    : `Updated ${savedEntry.word}.`);
}

function attachAudioButtons(doc) {
  const ctrl = LodVaultStore.createAudioController(doc);
  doc.addEventListener("click", (event) => {
    const btn = event.target.closest(".audio-btn");
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    const id = btn.dataset.audioId;
    if (!id) return;
    const url = `https://lod.lu/uploads/OGG/${id.toLowerCase()}.ogg`;
    ctrl.play(url, btn);
  });
}

function attachMeaningToggles(doc) {
  doc.addEventListener("click", (event) => {
    const toggle = event.target.closest(".meaning-toggle");
    if (!toggle) return;
    event.preventDefault();
    event.stopPropagation();
    const isOpen = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", isOpen ? "false" : "true");
    const panel = toggle.nextElementSibling;
    if (panel && panel.classList.contains("meaning-expand")) {
      panel.classList.toggle("is-open", !isOpen);
    }
  });
}

function attachPreviewNoteEditors(doc) {
  for (const entryElement of doc.querySelectorAll(".entry[data-id]")) {
    if (entryElement.querySelector(".preview-note-section")) continue;

    const id = entryElement.dataset.id;
    const entry = currentEntriesById.get(id);
    if (!entry) continue;

    entryElement.querySelector(".note")?.remove();

    const noteSection = doc.createElement("div");
    noteSection.className = "preview-note-section";

    const noteToggle = doc.createElement("button");
    noteToggle.type = "button";
    noteToggle.className = `note-toggle${entry.note ? " is-hidden" : ""}`;
    noteToggle.setAttribute("aria-label", "Add a note");
    noteToggle.setAttribute("aria-expanded", entry.note ? "true" : "false");
    noteToggle.textContent = "+ Note";
    noteToggle.addEventListener("click", () => {
      setPreviewNoteExpanded(noteSection, true);
      noteSection.querySelector(".note-input")?.focus();
    });

    const noteBody = doc.createElement("div");
    noteBody.className = `note-body${entry.note ? "" : " is-hidden"}`;

    const noteLabel = doc.createElement("label");
    noteLabel.className = "note-label";
    noteLabel.setAttribute("for", `preview-note-${id}`);
    noteLabel.textContent = "Note";

    const noteInput = doc.createElement("textarea");
    noteInput.id = `preview-note-${id}`;
    noteInput.className = "note-input";
    noteInput.dataset.noteId = id;
    noteInput.dataset.savedValue = entry.note || "";
    noteInput.placeholder = "Add a note for this word...";
    noteInput.value = entry.note || "";
    noteInput.addEventListener("input", () => previewNoteAutosave.markDirty(noteInput));
    noteInput.addEventListener("change", () => previewNoteAutosave.commit(noteInput));
    noteInput.addEventListener("focusout", () => previewNoteAutosave.commit(noteInput));
    noteInput.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        previewNoteAutosave.commit(noteInput);
      }
    });

    const noteStatus = doc.createElement("p");
    noteStatus.className = "preview-note-status";
    noteStatus.textContent = entry.note
      ? "Saved with this word."
      : "Add a short note — it saves automatically.";

    noteBody.append(noteLabel, noteInput, noteStatus);
    noteSection.append(noteToggle, noteBody);
    entryElement.appendChild(noteSection);
  }
}

function hideDeleteUndo() {
  if (deleteUndoTimer) {
    clearTimeout(deleteUndoTimer);
    deleteUndoTimer = null;
  }
  pendingDeletedEntry = null;
  document.getElementById("delete-undo")?.classList.add("is-hidden");
}

function showDeleteUndo(entry) {
  if (!entry?.id) return;
  if (deleteUndoTimer) clearTimeout(deleteUndoTimer);
  pendingDeletedEntry = JSON.parse(JSON.stringify(entry));
  document.getElementById("delete-undo-message").textContent = `Removed ${entry.word}.`;
  document.getElementById("delete-undo")?.classList.remove("is-hidden");
  deleteUndoTimer = setTimeout(hideDeleteUndo, 8000);
}

async function undoDelete() {
  if (!pendingDeletedEntry) return;
  const entry = pendingDeletedEntry;
  const button = document.getElementById("delete-undo-button");
  button.disabled = true;

  try {
    await LodVaultStore.restoreEntry(entry);
    hideDeleteUndo();
    await renderPreview({ preserveView: true });
  } finally {
    button.disabled = false;
  }
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
    LodVaultStore.setHtml(favBtn, '<span class="preview-toggle-pill-icon">' + (isFav ? "★" : "☆") + '</span><span class="preview-toggle-pill-label">Fav</span>');
    favBtn.addEventListener("click", async () => {
      favBtn.disabled = true;
      try {
        await handlePreviewToggle(id, "favorite");
        await renderPreview({ preserveView: true });
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
    LodVaultStore.setHtml(studyBtn, '<span class="preview-toggle-pill-icon">' + (isStudy ? "●" : "○") + '</span><span class="preview-toggle-pill-label">Study</span>');
    studyBtn.addEventListener("click", async () => {
      studyBtn.disabled = true;
      try {
        await handlePreviewToggle(id, "study");
        await renderPreview({ preserveView: true });
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
        const entry = currentEntriesById.get(id);
        if (!entry) return;
        await LodVaultStore.removeEntry(id);
        showDeleteUndo(entry);
        await renderPreview({ preserveView: true });
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

function capturePreviewView() {
  const doc = frame.contentDocument;
  if (!doc) return null;

  return {
    scrollX: frame.contentWindow?.scrollX || 0,
    scrollY: frame.contentWindow?.scrollY || 0,
    openMeanings: Array.from(doc.querySelectorAll('.meaning-toggle[aria-expanded="true"]'))
      .map((toggle) => toggle.closest(".entry")?.dataset.id)
      .filter(Boolean)
  };
}

function restorePreviewView(state) {
  if (!state) return;
  const doc = frame.contentDocument;
  if (!doc) return;

  const entriesById = new Map(Array.from(doc.querySelectorAll(".entry[data-id]"))
    .map((entry) => [entry.dataset.id, entry]));
  for (const id of state.openMeanings) {
    const toggle = entriesById.get(id)?.querySelector(".meaning-toggle");
    const panel = toggle?.nextElementSibling;
    if (!toggle || !panel?.classList.contains("meaning-expand")) continue;
    toggle.setAttribute("aria-expanded", "true");
    panel.classList.add("is-open");
  }

  frame.contentWindow?.scrollTo(state.scrollX, state.scrollY);
}

async function renderPreview({ preserveView = false } = {}) {
  const previewView = preserveView ? capturePreviewView() : null;
  let entries = await LodVaultStore.getEntries();
  entries = sortEntries(entries, currentSort);
  currentEntriesById = new Map(entries.map((entry) => [entry.id, entry]));
  populateLangSelect(entries);

  const html = LodVaultStore.buildExportHtml(entries, { includeInlineScript: false });
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
    restorePreviewView(previewView);
  };
  frame.src = url;
}

async function downloadHtml() {
  let entries = await LodVaultStore.getEntries();
  entries = sortEntries(entries, currentSort);
  const html = LodVaultStore.buildExportHtml(entries);
  const date = new Date().toISOString().slice(0, 10);
  LodVaultStore.downloadTextFile(`lodvault-export-${date}.html`, html, "text/html");
}

async function downloadAnki() {
  let entries = await LodVaultStore.getEntries();
  entries = sortEntries(entries, currentSort);
  const text = LodVaultStore.buildAnkiExport(entries);
  const date = new Date().toISOString().slice(0, 10);
  LodVaultStore.downloadTextFile(`lodvault-anki-${date}.txt`, text, "text/tab-separated-values");
}

window.addEventListener("beforeunload", () => {
  hideDeleteUndo();
  if (actionFeedbackTimer) clearTimeout(actionFeedbackTimer);
  previewNoteAutosave.destroy();
  if (currentPreviewUrl) {
    URL.revokeObjectURL(currentPreviewUrl);
  }
});
