// Dictionary source for the Words tab. Reuses Lens's API client and the vault's
// mutation queue; search never records visits or saves entries implicitly.
(() => {
  function createLookupModule(ctx) {
    const { store, state } = ctx;
    const lookup = globalThis.LodVaultLensLookup;
    const RESULT_LIMIT = 20;
    let query = "";
    let language = "all";
    let phase = "idle";
    let results = [];
    let total = 0;
    let requestId = 0;
    let timer = null;
    let destroyed = false;
    const entryRequests = new Map();
    const pending = new Set();
    const elements = {};
    const escape = store.escapeHtml;

    function rowFor(id) {
      return [...elements.results.querySelectorAll(".lookup-result")].find((row) => row.dataset.id === id);
    }

    function savedEntry(id) {
      return state.savedEntries.find((entry) => entry.id === id);
    }

    function saveMarkup(result) {
      const busy = pending.has(result.id);
      return savedEntry(result.id)
        ? '<span class="lookup-saved">✓ In vault</span>'
        : `<button type="button" class="btn-primary lookup-save" data-action="save" data-id="${escape(result.id)}" ${busy ? "disabled" : ""} aria-label="Save ${escape(result.word)} to Favorites">${busy ? "Saving…" : "Save to Favorites"}</button>`;
    }

    function resultMarkup(result) {
      const translations = Object.entries(result.translations || {}).filter(([, value]) => value);
      return `<article class="lookup-result" data-id="${escape(result.id)}">
        <div class="lookup-result-head"><div class="lookup-word"><a class="word-link" href="${escape(result.url)}" target="_blank" rel="noopener noreferrer" lang="lb">${escape(result.word)}</a><p class="item-meta">${escape(result.pos)}</p></div><div class="lookup-save-area">${saveMarkup(result)}</div></div>
        ${translations.length ? `<div class="lookup-match-translations">${translations.map(([lang, text]) => `<p><span class="meaning-label">${escape(lang.toUpperCase())}</span><span lang="${escape(lang)}">${escape(text)}</span></p>`).join("")}</div>` : '<p class="lookup-source-label">Luxembourgish entry · LOD dictionary</p>'}
        <details class="lookup-details"><summary>Translations, example & lists</summary><div class="lookup-entry-body"></div></details>
      </article>`;
    }

    async function flushNotes() {
      // Re-scan: an editor can change while another editor's save is pending.
      // Stop only once every remaining draft is clean in the same JS turn.
      while (true) {
        const editors = [...(elements.results?.querySelectorAll("textarea[data-note-id]") || [])].filter((textarea) =>
          (textarea.dataset.dirty === "true" || textarea.dataset.saving === "true") && textarea.dataset.discarded !== "true");
        if (!editors.length) return true;
        if (editors.some((textarea) => textarea.disabled)) return false;
        const outcomes = await Promise.all(editors.map((textarea) => ctx.noteAutosave.flush(textarea)));
        if (!outcomes.every(Boolean)) return false;
      }
    }

    function render() {
      if (destroyed || state.searchSource !== "lod") return;
      elements.panel.setAttribute("aria-busy", String(phase === "loading"));
      elements.status.textContent = phase === "loading" ? "Searching…" : phase === "results" ? `${total} match${total === 1 ? "" : "es"}` : "";
      let markup;
      if (phase === "idle") {
        markup = '<div class="empty-state lookup-state"><h3>Find a Luxembourgish word</h3><p>Search in any LOD language, then save the Luxembourgish entry.</p><p class="lookup-privacy">Only your search text is sent to LOD.</p></div>';
      } else if (phase === "loading") {
        markup = '<p class="lookup-state-copy">Searching the LOD dictionary…</p>';
      } else if (phase === "error") {
        markup = '<div class="empty-state lookup-state"><h3>LOD could not be reached</h3><p>Your saved words are still available in My vault.</p><button type="button" class="btn-ghost" data-action="retry">Try again</button></div>';
      } else if (!results.length) {
        markup = `<div class="empty-state lookup-state"><h3>No dictionary matches</h3><p>No results for "${escape(query.trim())}". Try another spelling${language === "all" ? "." : " or search all languages."}</p>${language === "all" ? "" : '<button type="button" class="btn-ghost" data-action="all-languages">Search all languages</button>'}<a class="lookup-lod-link" href="${escape(lookup.buildSearchPageUrl(query, language === "all" ? "lb" : language))}" target="_blank" rel="noopener noreferrer">Open search on LOD</a></div>`;
      } else {
        markup = `<p class="lookup-results-label">LOD dictionary <span>${total} match${total === 1 ? "" : "es"}</span></p>${results.map(resultMarkup).join("")}${total > RESULT_LIMIT ? `<p class="list-overflow">Showing ${RESULT_LIMIT} of ${total} matches. Refine your search to narrow down.</p>` : ""}`;
      }
      store.setHtml(elements.results, markup);
    }

    function invalidate() {
      requestId += 1;
      clearTimeout(timer);
      timer = null;
    }

    async function searchNow() {
      clearTimeout(timer);
      timer = null;
      if (destroyed || state.searchSource !== "lod") return;
      const normalized = lookup.normalizeSelection(query);
      const currentRequest = ++requestId;
      if (!await flushNotes()) {
        if (!destroyed && currentRequest === requestId) {
          elements.status.textContent = "Note not saved";
          elements.panel.setAttribute("aria-busy", "false");
          const deletedDraft = elements.results.querySelector('.lookup-draft-recovery:not(.is-hidden)');
          ctx.showActionFeedback(deletedDraft ? "A word was removed. Save it again or discard its draft to search." : "Could not save your note. Retry the note before searching again.", "error");
        }
        return;
      }
      if (destroyed || currentRequest !== requestId || state.searchSource !== "lod") return;
      results = [];
      total = 0;
      phase = normalized ? "loading" : "idle";
      render();
      if (!normalized) return;
      try {
        const response = await lookup.search(normalized, { language });
        if (destroyed || currentRequest !== requestId || state.searchSource !== "lod") return;
        total = response.candidates.length;
        results = response.candidates.slice(0, RESULT_LIMIT);
        phase = "results";
      } catch {
        if (destroyed || currentRequest !== requestId || state.searchSource !== "lod") return;
        phase = "error";
      }
      render();
    }

    function scheduleSearch() {
      invalidate();
      if (lookup.normalizeSelection(query)) {
        elements.status.textContent = "Searching…";
        timer = setTimeout(searchNow, 350);
      } else {
        void searchNow();
      }
    }

    function setSource(source) {
      if (source === state.searchSource) return;
      invalidate();
      if (state.searchSource === "lod") query = elements.input.value;
      if (source === "lod" && !query) query = state.searchQuery;
      state.searchSource = source;
      const isLod = source === "lod";
      elements.vaultSource.classList.toggle("is-active", !isLod);
      elements.lodSource.classList.toggle("is-active", isLod);
      elements.vaultSource.setAttribute("aria-checked", String(!isLod));
      elements.lodSource.setAttribute("aria-checked", String(isLod));
      ctx.elements.currentPageCard.classList.toggle("is-lookup-context", isLod);
      elements.vaultPanel.classList.toggle("is-hidden", isLod);
      elements.panel.classList.toggle("is-hidden", !isLod);
      elements.languageRow.classList.toggle("is-hidden", !isLod);
      elements.input.value = isLod ? query : state.searchQuery;
      elements.input.placeholder = isLod ? "Search a word in LOD…" : "Search words, type, translation, note…";
      elements.input.setAttribute("aria-label", isLod ? "Search the LOD dictionary" : "Search saved words");
      if (isLod) void searchNow();
      else {
        elements.panel.setAttribute("aria-busy", "false");
        ctx.list.renderList();
      }
      elements.input.focus();
    }

    async function getFullEntry(result) {
      if (!entryRequests.has(result.id)) {
        const promise = lookup.fetchEntry(result.id).then((entry) => {
          if (!entry || entry.id !== result.id || !entry.word) throw new Error("Invalid LOD entry.");
          return entry;
        }).catch((error) => {
          entryRequests.delete(result.id);
          throw error;
        });
        entryRequests.set(result.id, promise);
      }
      const entry = await entryRequests.get(result.id);
      // Keep the current search match when the canonical entry omits that
      // language; canonical entry translations still win when both exist.
      return { ...entry, translations: { ...result.translations, ...entry.translations } };
    }

    function detailMarkup(entry) {
      const saved = savedEntry(entry.id);
      const noteId = `lookup-note-${entry.id}`;
      return `<div class="lookup-translations">${store.buildMeaningRowsMarkup(entry)}</div>
        ${entry.inflection ? `<p class="item-meta">${escape(entry.inflection)}</p>` : ""}
        ${entry.example ? `<p class="item-example" lang="lb">${escape(entry.example)}</p>` : ""}
        <div class="word-toggles lookup-list-actions"><button type="button" class="toggle-pill toggle-fav" data-action="favorite" data-id="${escape(entry.id)}" aria-pressed="false"><span class="toggle-pill-icon">☆</span>Favorite</button><button type="button" class="toggle-pill toggle-study" data-action="study" data-id="${escape(entry.id)}" aria-pressed="false"><span class="toggle-pill-icon">○</span>Study</button></div>
        <div class="note-section"><label class="note-label" for="${escape(noteId)}">Note</label><textarea id="${escape(noteId)}" class="note-input" data-note-id="${escape(entry.id)}" data-lookup-note="true" data-saved-value="${escape(saved?.note || "")}" ${saved ? "" : "disabled"} placeholder="${saved ? "Add a note for this word…" : "Save this word to add a note…"}">${escape(saved?.note || "")}</textarea><p class="note-status muted" aria-live="polite">${saved ? "Notes save automatically." : "Favorite or Study saves the word."}</p><div class="lookup-draft-recovery is-hidden"><p class="helper-text">This word was removed from your vault. Save it again to keep your draft, or discard the draft.</p><div class="lookup-recovery-actions"><button type="button" class="btn-ghost" data-action="restore-note" data-id="${escape(entry.id)}">Save word again</button><button type="button" class="text-link" data-action="discard-note" data-id="${escape(entry.id)}">Discard draft</button></div></div></div>`;
    }

    async function showDetails(result) {
      const row = rowFor(result.id);
      const body = row?.querySelector(".lookup-entry-body");
      if (!body || body.dataset.loaded === "true" || body.dataset.loading === "true") return;
      body.dataset.loading = "true";
      store.setHtml(body, '<p class="lookup-state-copy">Loading entry…</p>');
      try {
        const entry = await getFullEntry(result);
        if (destroyed || !body.isConnected) return;
        store.setHtml(body, detailMarkup(entry));
        body.dataset.loaded = "true";
        refreshSavedState();
      } catch {
        if (!destroyed && body.isConnected) store.setHtml(body, `<p class="lookup-state-copy">Could not load this entry.</p><button type="button" class="btn-ghost" data-action="retry-entry" data-id="${escape(result.id)}">Try again</button>`);
      } finally {
        body.dataset.loading = "";
      }
    }

    // Patch membership and notes in place. Storage events must not replace a
    // focused textarea, collapse a definition, or erase an unsaved note draft.
    function refreshSavedState() {
      if (destroyed || !elements.results) return;
      for (const result of results) {
        const row = rowFor(result.id);
        if (!row) continue;
        const saved = savedEntry(result.id);
        const saveArea = row.querySelector(".lookup-save-area");
        const saveButton = saveArea.querySelector("button");
        if (!saved && saveButton) {
          saveButton.disabled = pending.has(result.id);
          saveButton.textContent = pending.has(result.id) ? "Saving…" : "Save to Favorites";
        } else if (Boolean(saved) !== Boolean(saveArea.querySelector(".lookup-saved"))) {
          const hadFocus = document.activeElement === saveButton;
          store.setHtml(saveArea, saveMarkup(result));
          if (hadFocus) row.querySelector("summary")?.focus({ preventScroll: true });
        }
        for (const list of ["favorite", "study"]) {
          const button = row.querySelector(`[data-action="${list}"]`);
          if (!button) continue;
          const enabled = Boolean(saved?.[list]);
          button.disabled = pending.has(result.id);
          button.classList.toggle("is-active", enabled);
          button.setAttribute("aria-pressed", String(enabled));
          button.querySelector(".toggle-pill-icon").textContent = list === "favorite" ? enabled ? "★" : "☆" : enabled ? "●" : "○";
        }
        const note = row.querySelector(".note-input");
        if (note) {
          note.disabled = !saved;
          const recovery = row.querySelector(".lookup-draft-recovery");
          recovery?.classList.toggle("is-hidden", Boolean(saved) || note.dataset.discarded === "true" || (note.dataset.dirty !== "true" && note.dataset.saving !== "true"));
          const restore = recovery?.querySelector('[data-action="restore-note"]');
          if (restore) restore.disabled = pending.has(result.id);
          note.placeholder = saved ? "Add a note for this word…" : "Save this word to add a note…";
          if (note !== document.activeElement && note.dataset.dirty !== "true" && note.dataset.saving !== "true") {
            note.value = saved?.note || "";
            note.dataset.savedValue = note.value;
          }
        }
      }
    }

    async function onClick(event) {
      const button = event.target.closest("button[data-action]");
      if (!button || button.disabled) return;
      const action = button.dataset.action === "restore-note" ? "save" : button.dataset.action;
      const wasFocused = document.activeElement === button;
      if (action === "retry") return searchNow();
      if (action === "all-languages") {
        language = "all";
        elements.language.value = language;
        return searchNow();
      }
      const result = results.find((item) => item.id === button.dataset.id);
      if (!result) return;
      if (action === "retry-entry") return showDetails(result);
      if (action === "discard-note") {
        const note = rowFor(result.id)?.querySelector(".note-input");
        if (note) {
          ctx.noteAutosave.clear(note);
          note.value = "";
          note.dataset.savedValue = "";
          note.dataset.dirty = "";
          note.dataset.resave = "";
          note.dataset.discarded = "true";
          refreshSavedState();
          elements.input.focus();
        }
        return;
      }
      if (!["save", "favorite", "study"].includes(action) || pending.has(result.id)) return;
      pending.add(result.id);
      refreshSavedState();
      let failed = false;
      try {
        // Always hydrate before saving: a search preview is not a full entry.
        const entry = await getFullEntry(result);
        const saved = action === "save"
          ? await store.addToList(entry, "favorite")
          : await store.toggleList(entry, action);
        if (destroyed) return;
        ctx.current.updateSavedEntryState(saved);
        await ctx.list.renderSavedList();
        if (destroyed) return;
        const restoredNote = rowFor(result.id)?.querySelector(".note-input");
        if (action === "save" && restoredNote?.dataset.dirty === "true") {
          // Deletion invalidates the old saved baseline, even if the user\'s
          // draft happens to equal the note that existed before deletion.
          restoredNote.dataset.savedValue = saved?.note || "";
          await ctx.noteAutosave.flush(restoredNote);
        }
        const enabled = Boolean(saved?.[action]);
        ctx.showActionFeedback(action === "save" ? `Saved ${entry.word} to Favorites.` : `${enabled ? "Added" : "Removed"} ${entry.word} ${enabled ? "to" : "from"} ${action === "study" ? "Study" : "Favorites"}.`);
        const activeRow = rowFor(result.id);
        if (action === "save" && document.activeElement === document.body) activeRow?.querySelector("summary")?.focus({ preventScroll: true });
      } catch {
        failed = true;
        if (!destroyed) ctx.showActionFeedback("Could not save this word. Try again.", "error");
      } finally {
        pending.delete(result.id);
        refreshSavedState();
        if (!destroyed && failed && wasFocused && button.isConnected && document.activeElement === document.body) button.focus({ preventScroll: true });
      }
    }

    function onToggle(event) {
      if (!event.target.matches(".lookup-details") || !event.target.open) return;
      const result = results.find((item) => item.id === event.target.closest(".lookup-result")?.dataset.id);
      if (result) void showDetails(result);
    }

    function onInput(event) {
      query = event.target.value;
      scheduleSearch();
    }

    function onLanguageChange() {
      language = elements.language.value;
      scheduleSearch();
    }

    function onKeyDown(event) {
      if (event.key !== "Enter" || state.searchSource !== "lod") return;
      event.preventDefault();
      query = elements.input.value;
      invalidate();
      void searchNow();
    }

    function init() {
      destroyed = false;
      elements.input = ctx.elements.searchInput;
      elements.status = ctx.elements.searchStatus;
      elements.vaultSource = document.getElementById("search-source-vault");
      elements.lodSource = document.getElementById("search-source-lod");
      elements.vaultPanel = document.getElementById("vault-search-results");
      elements.panel = document.getElementById("lod-search-results");
      elements.results = document.getElementById("lod-results-list");
      elements.languageRow = document.getElementById("lod-search-language-row");
      elements.language = document.getElementById("lod-search-language");
      elements.vaultSource.addEventListener("click", onVaultSource);
      elements.lodSource.addEventListener("click", onLodSource);
      elements.language.addEventListener("change", onLanguageChange);
      elements.input.addEventListener("keydown", onKeyDown);
      elements.results.addEventListener("click", onClick);
      elements.results.addEventListener("toggle", onToggle, true);
      elements.results.addEventListener("input", ctx.list.onSavedListInput);
      elements.results.addEventListener("change", ctx.list.onSavedListChange);
      elements.results.addEventListener("focusout", ctx.list.onSavedListFocusOut);
    }

    function onVaultSource() { setSource("vault"); }
    function onLodSource() { setSource("lod"); }

    function destroy() {
      void flushNotes();
      destroyed = true;
      invalidate();
      elements.vaultSource?.removeEventListener("click", onVaultSource);
      elements.lodSource?.removeEventListener("click", onLodSource);
      elements.language?.removeEventListener("change", onLanguageChange);
      elements.input?.removeEventListener("keydown", onKeyDown);
      elements.results?.removeEventListener("click", onClick);
      elements.results?.removeEventListener("toggle", onToggle, true);
      elements.results?.removeEventListener("input", ctx.list.onSavedListInput);
      elements.results?.removeEventListener("change", ctx.list.onSavedListChange);
      elements.results?.removeEventListener("focusout", ctx.list.onSavedListFocusOut);
    }

    return { init, destroy, onInput, refreshSavedState };
  }

  globalThis.LodVaultPopupLookup = { create: createLookupModule };
})();
