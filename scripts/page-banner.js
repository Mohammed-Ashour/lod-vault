(() => {
  function createController(options = {}) {
    const BANNER_ID = options.bannerId || "lod-wrapper-banner";
    const getCurrentEntry = typeof options.getCurrentEntry === "function"
      ? options.getCurrentEntry
      : () => null;
    const getCurrentAutoMode = typeof options.getCurrentAutoMode === "function"
      ? options.getCurrentAutoMode
      : () => false;
    const onPopupStateChange = typeof options.onPopupStateChange === "function"
      ? options.onPopupStateChange
      : () => {};
    const isContextInvalidated = typeof options.isContextInvalidated === "function"
      ? options.isContextInvalidated
      : () => false;
    const onInvalidate = typeof options.onInvalidate === "function"
      ? options.onInvalidate
      : null;
    const store = options.store || globalThis.LodWrapperStore || {};
    const articleReader = options.articleReader || globalThis.LodWrapperArticleReader || {};

    let lastRenderKey = "";
    const bannerNoteController = store.createNoteAutosaveController({
      isBlocked: () => isContextInvalidated(),
      setStatus: (_textarea, message, tone = "") => setBannerNoteMeta(message, tone),
      saveNote: (noteId, requestValue) => store.saveNote(noteId, requestValue),
      getIdleMessage: () => "Auto-saves",
      getSavingMessage: () => "Saving…",
      getSavedMessage: ({ savedEntry, changedSinceRequest }) => changedSinceRequest ? "Saving…" : savedEntry?.note ? "Saved" : "Cleared",
      getErrorMessage: () => "Could not save",
      onSaved: async ({ textarea, savedEntry }) => {
        const sourceEntry = getCurrentEntry() || { id: textarea.dataset.noteId || savedEntry?.id || "", url: location.href };
        lastRenderKey = "";
        applyState(savedEntry, sourceEntry);
        onPopupStateChange(sourceEntry, savedEntry);
      },
      onError: async ({ error }) => {
        if (String(error || "").includes("Extension context invalidated") || String(error || "").includes("Extension updated — refresh the page")) {
          if (onInvalidate) {
            onInvalidate();
          } else {
            handleInvalidatedContext();
          }
          return true;
        }
        return false;
      },
      shouldKeepScheduling: (textarea) => Boolean(textarea?.isConnected)
    });

    function getBanner() {
      return document.getElementById(BANNER_ID);
    }

    function getBannerNoteInput() {
      return getBanner()?.querySelector(".lodw-note-input") || null;
    }

    function setBannerNoteMeta(message, tone = "") {
      const meta = getBanner()?.querySelector(".lodw-meta");
      if (!meta) return;
      meta.textContent = message;
      meta.dataset.tone = tone;
    }

    function setBannerNoteExpanded(noteToggle, noteBody, expanded) {
      if (noteToggle) {
        noteToggle.classList.toggle("is-hidden", expanded);
        noteToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
      }
      if (noteBody) {
        noteBody.classList.toggle("is-hidden", !expanded);
      }
    }

    function syncBannerNote(savedEntry, sourceEntry = getCurrentEntry()) {
      const textarea = getBannerNoteInput();
      if (!textarea) return;

      const banner = getBanner();
      const noteToggle = banner?.querySelector(".lodw-note-toggle");
      const noteBody = banner?.querySelector(".lodw-note-body");
      const noteId = sourceEntry?.id || savedEntry?.id || "";
      const savedValue = savedEntry?.note || "";
      const isSameEntry = textarea.dataset.noteId === noteId;
      const isDirty = isSameEntry && textarea.dataset.dirty === "true";
      const isFocused = document.activeElement === textarea;

      if (!noteId) {
        bannerNoteController.clear(textarea);
        textarea.value = "";
        textarea.dataset.noteId = "";
        textarea.dataset.savedValue = "";
        textarea.dataset.dirty = "";
        textarea.disabled = true;
        textarea.placeholder = "Open a word to add a note.";
        setBannerNoteExpanded(noteToggle, noteBody, false);
        setBannerNoteMeta("Open a word to add a note.");
        return;
      }

      textarea.dataset.noteId = noteId;
      textarea.dataset.savedValue = savedValue;
      textarea.placeholder = savedEntry
        ? "Add a note…"
        : "Save to enable notes…";
      textarea.disabled = !savedEntry || isContextInvalidated();

      if (noteToggle) noteToggle.disabled = !savedEntry || isContextInvalidated();
      if (savedValue) {
        setBannerNoteExpanded(noteToggle, noteBody, true);
      } else if (!isSameEntry && !isFocused) {
        setBannerNoteExpanded(noteToggle, noteBody, false);
      }

      if (!isDirty && (!isFocused || !isSameEntry)) {
        textarea.value = savedValue;
      }

      if (!savedEntry) {
        bannerNoteController.clear(textarea);
        textarea.dataset.dirty = "";
        textarea.value = "";
        setBannerNoteMeta("Save to enable notes.");
        return;
      }

      if (!isDirty) {
        setBannerNoteMeta(savedValue ? "Saved" : "Auto-saves");
      }
    }

    function buttonLabel(listName, active) {
      if (listName === "favorite") {
        return active ? "★ Favorited" : "☆ Favorite";
      }
      return active ? "✓ Study" : "+ Study";
    }

    function ensureBanner() {
      const heading = articleReader.getHeadingElement?.();
      if (!heading) return null;

      let banner = getBanner();
      if (!banner) {
        banner = document.createElement("section");
        banner.id = BANNER_ID;
        banner.innerHTML = `
          <div class="lodw-row">
            <span class="lodw-dot"></span>
            <span class="lodw-word"></span>
            <span class="lodw-info"></span>
            <div class="lodw-actions">
              <button type="button" data-list="favorite"></button>
              <button type="button" data-list="study"></button>
            </div>
          </div>
          <div class="lodw-note-row">
            <button type="button" class="lodw-note-toggle" aria-expanded="false">
              <span class="lodw-note-icon">📝</span>
              <span class="lodw-note-toggle-label">Add note</span>
            </button>
            <div class="lodw-note-body is-hidden">
              <textarea id="lodw-note-input" class="lodw-note-input" rows="1" placeholder="Add a note…" disabled></textarea>
            </div>
          </div>
          <div class="lodw-meta">Save to enable notes.</div>
        `;

        // Force truncation styles via inline setProperty so no external CSS can override.
        // The LOD page uses display:flex on #app which can cause the banner (as a flex
        // descendant) to size to content width, preventing text-overflow: ellipsis.
        const s = banner.style;
        s.setProperty("width", "100%", "important");
        s.setProperty("min-width", "0", "important");
        s.setProperty("max-width", "100%", "important");
        s.setProperty("overflow", "hidden", "important");
        s.setProperty("box-sizing", "border-box", "important");

        const row = banner.querySelector(".lodw-row");
        row.style.setProperty("overflow", "hidden", "important");
        row.style.setProperty("min-width", "0", "important");

        const infoEl = banner.querySelector(".lodw-info");
        infoEl.style.setProperty("overflow", "hidden", "important");
        infoEl.style.setProperty("text-overflow", "ellipsis", "important");
        infoEl.style.setProperty("white-space", "nowrap", "important");
        infoEl.style.setProperty("min-width", "0", "important");

        banner.addEventListener("input", (event) => {
          const textarea = event.target.closest(".lodw-note-input");
          if (!textarea) return;
          bannerNoteController.markDirty(textarea);
        });

        banner.addEventListener("change", (event) => {
          const textarea = event.target.closest(".lodw-note-input");
          if (!textarea) return;
          bannerNoteController.commit(textarea);
        });

        banner.addEventListener("focusout", (event) => {
          const textarea = event.target.closest(".lodw-note-input");
          if (!textarea) return;
          bannerNoteController.commit(textarea);
        });

        banner.addEventListener("keydown", (event) => {
          const textarea = event.target.closest(".lodw-note-input");
          if (!textarea) return;
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            bannerNoteController.commit(textarea);
          }
        });

        banner.addEventListener("click", (event) => {
          const toggle = event.target.closest(".lodw-note-toggle");
          if (!toggle || toggle.disabled) return;
          const noteBody = toggle.closest(".lodw-note-row")?.querySelector(".lodw-note-body");
          if (!noteBody) return;
          setBannerNoteExpanded(toggle, noteBody, true);
          noteBody.querySelector(".lodw-note-input")?.focus();
        });
      }

      if (banner.parentElement !== heading.parentElement || banner.previousElementSibling !== heading) {
        heading.insertAdjacentElement("afterend", banner);
      }

      return banner;
    }

    function setButtonsBusy(isBusy) {
      const banner = getBanner();
      if (!banner) return;
      for (const button of banner.querySelectorAll("button[data-list]")) {
        button.disabled = isBusy;
      }
    }

    function handleInvalidatedContext() {
      const banner = ensureBanner();
      if (!banner) return;

      banner.classList.add("is-warning");
      banner.querySelector(".lodw-word").textContent = "Extension updated";
      const infoEl = banner.querySelector(".lodw-info");
      infoEl.textContent = "Reload this page to re-enable.";
      infoEl.title = "";
      const dot = banner.querySelector(".lodw-dot");
      if (dot) { dot.className = "lodw-dot"; dot.textContent = ""; }
      const noteInput = getBannerNoteInput();
      if (noteInput) {
        bannerNoteController.clear(noteInput);
        noteInput.disabled = true;
      }
      setBannerNoteMeta("Reload this page to edit notes.", "error");
      setButtonsBusy(true);
    }

    function buildRenderKey(entry, savedEntry) {
      return JSON.stringify({
        entry,
        favorite: Boolean(savedEntry?.favorite),
        study: Boolean(savedEntry?.study),
        history: Boolean(savedEntry?.history),
        visitCount: Number(savedEntry?.visitCount || 0),
        lastVisitedAt: savedEntry?.lastVisitedAt || "",
        note: savedEntry?.note || "",
        autoMode: getCurrentAutoMode()
      });
    }

    function applyState(savedEntry, sourceEntry = getCurrentEntry()) {
      const entry = sourceEntry || savedEntry;
      const banner = ensureBanner();
      if (!banner) return;

      if (!entry) {
        const noteInput = getBannerNoteInput();
        if (noteInput) {
          bannerNoteController.clear(noteInput);
        }
        banner.style.display = "none";
        lastRenderKey = "";
        return;
      }

      const renderKey = buildRenderKey(entry, savedEntry);
      if (renderKey === lastRenderKey) return;
      lastRenderKey = renderKey;

      banner.style.display = "block";
      banner.classList.remove("is-warning");
      banner.querySelector(".lodw-word").textContent = entry.word || "";
      const infoEl = banner.querySelector(".lodw-info");
      const infoDisplay = articleReader.infoText?.(entry) || "";
      const infoTitle = articleReader.infoTextFull?.(entry) || infoDisplay;
      infoEl.textContent = infoDisplay;
      infoEl.title = infoTitle;

      const dot = banner.querySelector(".lodw-dot");
      if (dot) {
        dot.className = "lodw-dot";
        if (savedEntry?.favorite) {
          dot.classList.add("is-favorited");
        } else if (savedEntry) {
          dot.classList.add("is-saved");
        }
        if (getCurrentAutoMode()) {
          dot.classList.add("is-auto");
        }
      }

      for (const button of banner.querySelectorAll("button[data-list]")) {
        const isFavorite = button.dataset.list === "favorite";
        const active = isFavorite ? Boolean(savedEntry?.favorite) : Boolean(savedEntry?.study);
        button.textContent = buttonLabel(button.dataset.list, active);
        button.classList.toggle("is-active", active);
      }

      syncBannerNote(savedEntry, entry);
    }

    function clearRenderKey() {
      lastRenderKey = "";
    }

    return {
      ensureBanner,
      setButtonsBusy,
      handleInvalidatedContext,
      applyState,
      clearRenderKey,
      noteAutosave: bannerNoteController
    };
  }

  globalThis.LodWrapperPageBanner = {
    createController
  };
})();