(() => {
  // Restore-JSON page logic.
  //
  // This runs in a persistent extension tab (pages/import.html) rather than
  // the toolbar popup because Firefox unloads the browser-action popup the
  // moment a native file picker takes focus — so the popup's change handler
  // never fires and the import silently does nothing. A tab stays open across
  // the picker, so the import completes reliably in both Firefox and Chrome.
  //
  // The import runs directly against chrome.storage.local (the tab is a
  // full extension page with store access) via store.importJsonDirect,
  // avoiding the background message-proxy round-trip.
  const store = globalThis.LodVaultStore || {};
  const fileInput = document.getElementById("file-input");
  const dropzone = document.getElementById("dropzone");
  const statusEl = document.getElementById("status");
  const doneButton = document.getElementById("done");

  function setStatus(message, tone = "") {
    statusEl.textContent = message;
    statusEl.classList.remove("is-ok", "is-err", "is-busy");
    if (tone) statusEl.classList.add(`is-${tone}`);
  }

  async function importFile(file) {
    if (!file) return;

    const importHandler = typeof store.importJsonDirect === "function"
      ? store.importJsonDirect
      : store.importJson;

    if (typeof importHandler !== "function") {
      setStatus("Import is unavailable in this build.", "err");
      return;
    }

    setStatus(`Importing "${file.name}"…`, "busy");

    try {
      const text = await file.text();
      const result = await importHandler(text);
      const count = Number(result?.imported) || 0;
      setStatus(`Imported ${count} word${count === 1 ? "" : "s"}. You can close this tab.`, "ok");
    } catch (error) {
      console.error("[LODVault] JSON import failed:", error);
      const reason = error?.message || String(error || "Could not import that JSON file.");
      setStatus(`Could not import that JSON file. ${reason}`, "err");
    }
  }

  fileInput.addEventListener("change", () => {
    importFile(fileInput.files?.[0]);
  });

  // Drag-and-drop: the tab stays open, so this is a reliable alternative to
  // the file picker and works identically across browsers.
  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropzone.classList.add("is-over");
  });
  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("is-over");
  });
  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-over");
    const file = event.dataTransfer?.files?.[0];
    if (file) importFile(file);
  });

  doneButton.addEventListener("click", () => {
    // Close the tab. Fall back to hiding the UI if tabs.remove is unavailable.
    if (typeof chrome?.tabs?.remove === "function") {
      chrome.tabs.getCurrent?.((tab) => {
        if (tab?.id) chrome.tabs.remove(tab.id);
      });
    }
  });
})();
