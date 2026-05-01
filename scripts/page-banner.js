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
      return getBanner()?.querySelector(".lodw-note__input") || null;
    }

    function setBannerNoteMeta(message, tone = "") {
      const meta = getBanner()?.querySelector(".lodw-note__meta");
      if (!meta) return;
      meta.textContent = message;
      meta.dataset.tone = tone;
    }

    function syncBannerNote(savedEntry, sourceEntry = getCurrentEntry()) {
      const textarea = getBannerNoteInput();
      if (!textarea) return;

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
        textarea.placeholder = "Save to Favorites or Study to add a note...";
        setBannerNoteMeta("Open a word to add a note.");
        return;
      }

      textarea.dataset.noteId = noteId;
      textarea.dataset.savedValue = savedValue;
      textarea.placeholder = savedEntry
        ? "Add a note for this word..."
        : "Save to Favorites or Study to add a note...";
      textarea.disabled = !savedEntry || isContextInvalidated();

      if (!isDirty && (!isFocused || !isSameEntry)) {
        textarea.value = savedValue;
      }

      if (!savedEntry) {
        bannerNoteController.clear(textarea);
        textarea.dataset.dirty = "";
        textarea.value = "";
        setBannerNoteMeta("Save to Favorites or Study to enable notes.");
        return;
      }

      if (!isDirty) {
        setBannerNoteMeta(savedValue ? "Saved with this word." : "Add a short note — it saves automatically.");
      }
    }

    function statusText(savedEntry) {
      if (!savedEntry) return "Not saved yet";

      const labels = [];
      if (savedEntry.favorite) labels.push("Favorites");
      if (savedEntry.study) labels.push("Study");
      if (savedEntry.history) labels.push("History");

      if (!labels.length) return "Not saved yet";
      if (labels.length === 1) return `Saved in ${labels[0]}`;
      if (labels.length === 2) return `Saved in ${labels[0]} and ${labels[1]}`;
      return `Saved in ${labels[0]}, ${labels[1]}, and ${labels[2]}`;
    }

    function buttonLabel(listName, active) {
      if (listName === "favorite") {
        return active ? "★ Favorited" : "☆ Save to Favorites";
      }
      return active ? "✓ In Study" : "+ Add to Study";
    }

    function ensureBanner() {
      const heading = articleReader.getHeadingElement?.();
      if (!heading) return null;

      let banner = getBanner();
      if (!banner) {
        banner = document.createElement("section");
        banner.id = BANNER_ID;
        banner.innerHTML = `
          <div class="lodw-banner__main">
            <div class="lodw-banner__copy">
              <div class="lodw-banner__eyebrow">
                LODVault
                <span class="lodw-auto-badge is-hidden">Auto</span>
              </div>
              <div class="lodw-banner__status"></div>
              <div class="lodw-banner__info"></div>
            </div>
            <div class="lodw-banner__actions">
              <button type="button" data-list="favorite"></button>
              <button type="button" data-list="study"></button>
            </div>
          </div>
          <div class="lodw-banner__note">
            <label class="lodw-note__label" for="lodw-note-input">Note</label>
            <textarea id="lodw-note-input" class="lodw-note__input" rows="2" placeholder="Save to Favorites or Study to add a note..." disabled></textarea>
            <div class="lodw-note__meta">Save to Favorites or Study to enable notes.</div>
          </div>
        `;

        banner.addEventListener("input", (event) => {
          const textarea = event.target.closest(".lodw-note__input");
          if (!textarea) return;
          bannerNoteController.markDirty(textarea);
        });

        banner.addEventListener("change", (event) => {
          const textarea = event.target.closest(".lodw-note__input");
          if (!textarea) return;
          bannerNoteController.commit(textarea);
        });

        banner.addEventListener("focusout", (event) => {
          const textarea = event.target.closest(".lodw-note__input");
          if (!textarea) return;
          bannerNoteController.commit(textarea);
        });

        banner.addEventListener("keydown", (event) => {
          const textarea = event.target.closest(".lodw-note__input");
          if (!textarea) return;
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            bannerNoteController.commit(textarea);
          }
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
      banner.querySelector(".lodw-banner__status").textContent = "Extension updated — refresh page";
      banner.querySelector(".lodw-banner__info").textContent = "Reload this page to re-enable save actions.";
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
      banner.querySelector(".lodw-banner__status").textContent = statusText(savedEntry);
      banner.querySelector(".lodw-banner__info").textContent = articleReader.infoText?.(entry) || "Save this word to your personal lists.";

      const autoBadge = banner.querySelector(".lodw-auto-badge");
      if (autoBadge) autoBadge.classList.toggle("is-hidden", !getCurrentAutoMode());

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
      getBanner,
      getBannerNoteInput,
      setBannerNoteMeta,
      syncBannerNote,
      statusText,
      buttonLabel,
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
