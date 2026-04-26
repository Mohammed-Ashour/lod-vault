const frame = document.getElementById("preview-frame");
const meta = document.getElementById("preview-meta");
const refreshButton = document.getElementById("refresh-preview");
const downloadButton = document.getElementById("download-html");
let currentPreviewUrl = "";
let currentSearchQuery = "";

refreshButton.addEventListener("click", renderPreview);
downloadButton.addEventListener("click", downloadHtml);

document.addEventListener("DOMContentLoaded", renderPreview);

function injectPreviewStyles(doc) {
  if (doc.getElementById("lod-wrapper-preview-style")) return;

  const style = doc.createElement("style");
  style.id = "lod-wrapper-preview-style";
  style.textContent = `
    .preview-entry-actions {
      margin-top: 12px;
      display: flex;
      justify-content: flex-end;
    }
    .preview-remove-button {
      border: 1px solid #ffd2d2;
      background: #fff5f5;
      color: #c33636;
      border-radius: 10px;
      padding: 8px 12px;
      font: inherit;
      font-size: 0.9rem;
      font-weight: 700;
      cursor: pointer;
    }
    .preview-remove-button:hover {
      background: #ffeaea;
    }
    .preview-remove-button:disabled {
      opacity: 0.7;
      cursor: wait;
    }
  `;
  doc.head.appendChild(style);
}

function attachPreviewSearch() {
  const doc = frame.contentDocument;
  if (!doc) return;

  injectPreviewStyles(doc);

  const input = doc.getElementById("search-input");
  const status = doc.getElementById("search-status");
  const empty = doc.getElementById("search-empty");
  const entries = Array.from(doc.querySelectorAll(".entry"));
  if (!input || !status || !empty) return;

  const applySearch = () => {
    const query = (input.value || "").trim().toLowerCase();
    currentSearchQuery = input.value || "";
    let visibleCount = 0;

    for (const entry of entries) {
      const match = !query || (entry.dataset.search || "").includes(query);
      entry.hidden = !match;
      if (match) visibleCount += 1;
    }

    status.textContent = query
      ? `${visibleCount} matching word${visibleCount === 1 ? "" : "s"}`
      : `${entries.length} saved word${entries.length === 1 ? "" : "s"}`;
    empty.hidden = visibleCount !== 0 || !query;
  };

  input.value = currentSearchQuery;
  input.addEventListener("input", applySearch);
  attachRemoveButtons(doc);
  applySearch();
}

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
  for (const entryElement of doc.querySelectorAll(".entry[data-id][data-list]")) {
    if (entryElement.querySelector(".preview-entry-actions")) continue;

    const listName = entryElement.dataset.list;
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "preview-remove-button";
    button.textContent = previewRemoveLabel(listName);

    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await handlePreviewRemove(entryElement.dataset.id, listName);
        await renderPreview();
      } finally {
        button.disabled = false;
      }
    });

    const actions = doc.createElement("div");
    actions.className = "preview-entry-actions";
    actions.appendChild(button);
    entryElement.appendChild(actions);
  }
}

async function renderPreview() {
  const entries = await LodWrapperStore.getEntries();
  const html = LodWrapperStore.buildExportHtml(entries, { includeInlineScript: false });
  const count = `${entries.length} saved word${entries.length === 1 ? "" : "s"}`;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);

  if (currentPreviewUrl) {
    URL.revokeObjectURL(currentPreviewUrl);
  }

  currentPreviewUrl = url;
  meta.textContent = `${count} · live preview from local extension storage`;
  frame.onload = attachPreviewSearch;
  frame.src = url;
}

async function downloadHtml() {
  const entries = await LodWrapperStore.getEntries();
  const html = LodWrapperStore.buildExportHtml(entries);
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);

  link.href = url;
  link.download = `lodvault-export-${date}.html`;
  link.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

window.addEventListener("beforeunload", () => {
  if (currentPreviewUrl) {
    URL.revokeObjectURL(currentPreviewUrl);
  }
});
