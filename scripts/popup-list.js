// popup-list.js — Saved-list feature module for the popup page.
//
// Owns the saved words list (render, search, stats, Favorite/Study/Note/Delete
// interactions), the Flashcards/Vault page openers, and the renderSavedList hub
// that refreshes every popup section after the vault changes. Renders into the
// popup DOM through the shared ctx object.
//
// Cross-module calls (resolved lazily at runtime):
//   ctx.current.renderAutoMode()          — history count in the auto-mode copy
//   ctx.current.syncCurrentCardState()    — current card after vault changes
//   ctx.current.showNoteBody()            — "+ Note" reveal in list items
//   ctx.sync.renderSyncLanguages()        — chips/capacity after vault changes
//   ctx.sync.renderVerifiedSyncStatus()   — verified label after vault changes
//   ctx.sync.refreshSyncHealth()          — health banner after vault changes
//   ctx.backup.renderPortableBackupStatus() — backup chip after vault changes
//   ctx.study.refreshStudyCard()           — due/new counts after vault changes
//   ctx.showActionFeedback()              — transient action feedback toast
//   ctx.deleteUndo.deleteEntry()          — delete-with-undo for list items
//   ctx.noteAutosave                      — autosave for list note textareas
(() => {
  function createListModule(ctx) {
    const { store, chromeApi, state, elements } = ctx;

    const LIST_LIMIT = 10;

    function renderSummary(entries) {
      const favoriteCount = entries.filter((entry) => entry.favorite).length;
      const studyCount = entries.filter((entry) => entry.study).length;
      const historyCount = entries.filter((entry) => entry.history).length;

      elements.favoriteCount.textContent = String(favoriteCount);
      elements.studyCount.textContent = String(studyCount);
      elements.historyCount.textContent = String(historyCount);
      elements.totalCount.textContent = String(entries.length);
    }

    function formatSearchStatus(filteredCount, totalCount) {
      if (!state.searchQuery) {
        if (!totalCount) return "0 saved words";
        const visibleCount = Math.min(totalCount, LIST_LIMIT);
        return `${totalCount} saved word${totalCount === 1 ? "" : "s"} · showing ${visibleCount} recent`;
      }
      return `${filteredCount} match${filteredCount === 1 ? "" : "es"} · ${totalCount} total`;
    }

    function entrySubline(entry) {
      const parts = [];
      if (entry.pos) parts.push(entry.pos);
      if (entry.history) {
        const count = entry.visitCount || 1;
        parts.push(`Visited ${count} time${count === 1 ? "" : "s"}`);
      }
      return parts.length ? store.escapeHtml(parts.join(" · ")) : "";
    }

    function filteredEntries(entries) {
      const query = state.searchQuery.trim().toLowerCase();
      if (!query) return entries;
      return entries.filter((entry) => store.buildSearchText(entry).includes(query));
    }

    function buildSavedItemMarkup(entry) {
      const lastVisitedText = entry.history && entry.lastVisitedAt
        ? `<p class="item-meta">Last visited ${store.escapeHtml(store.formatWhen(entry.lastVisitedAt))}</p>`
        : "";
      const hasNote = Boolean(entry.note);

      return `
        <article class="saved-item" data-id="${store.escapeHtml(entry.id)}">
          <div class="saved-item-top">
            <span class="word-row">${typeof store.buildAudioBtnMarkup === "function" ? store.buildAudioBtnMarkup(entry) : ""}<a href="${store.escapeHtml(entry.url)}" target="_blank" rel="noreferrer" class="word-link">${store.escapeHtml(entry.word)}</a></span>
            <div class="item-controls">
              <button type="button" class="toggle-pill toggle-fav ${entry.favorite ? "is-active" : ""}" data-action="toggle-favorite" data-id="${store.escapeHtml(entry.id)}" aria-pressed="${entry.favorite ? "true" : "false"}" title="${entry.favorite ? "Remove from favorites" : "Add to favorites"}"><span class="toggle-pill-icon">${entry.favorite ? "★" : "☆"}</span><span class="toggle-pill-label">Fav</span></button>
              <button type="button" class="toggle-pill toggle-study ${entry.study ? "is-active" : ""}" data-action="toggle-study" data-id="${store.escapeHtml(entry.id)}" aria-pressed="${entry.study ? "true" : "false"}" title="${entry.study ? "Remove from study list" : "Add to study list"}"><span class="toggle-pill-icon">${entry.study ? "●" : "○"}</span><span class="toggle-pill-label">Study</span></button>
              <button type="button" class="control-btn control-delete" data-action="remove" data-id="${store.escapeHtml(entry.id)}" aria-label="Delete saved word" title="Delete saved word">×</button>
            </div>
          </div>
          ${entrySubline(entry) ? `<p class="item-meta">${entrySubline(entry)}</p>` : ""}
          ${lastVisitedText}
          ${(() => { const mk = store.buildMeaningCollapsibleMarkup(entry); return mk ? `<div class="item-meanings">${mk}</div>` : ""; })()}
          ${entry.example ? `<p class="item-example">${store.escapeHtml(entry.example)}</p>` : ""}
          <div class="note-section">
            <button type="button" class="note-toggle${hasNote ? " is-hidden" : ""}" data-action="toggle-note" data-id="${store.escapeHtml(entry.id)}" aria-label="Add a note">+ Note</button>
            <div class="note-body${hasNote ? "" : " is-hidden"}">
              <label class="note-label" for="note-${store.escapeHtml(entry.id)}">Note</label>
              <textarea id="note-${store.escapeHtml(entry.id)}" class="note-input" data-note-id="${store.escapeHtml(entry.id)}" data-saved-value="${store.escapeHtml(entry.note || "")}" placeholder="Add a note for this word...">${store.escapeHtml(entry.note || "")}</textarea>
            </div>
          </div>
        </article>
      `;
    }

    async function renderSavedList() {
      const entries = await store.getEntries();
      state.savedEntries = entries;
      renderSummary(entries);
      ctx.current.renderAutoMode();
      ctx.sync.renderSyncLanguages();
      ctx.sync.renderVerifiedSyncStatus();
      await ctx.sync.refreshSyncHealth();
      renderList();
      ctx.backup.renderPortableBackupStatus();
      if (ctx.study) await ctx.study.refreshStudyCard();
      await ctx.current.syncCurrentCardState();
    }

    function renderList() {
      const entries = state.savedEntries;
      const visibleEntries = filteredEntries(entries);
      const hasQuery = state.searchQuery.trim().length > 0;
      const displayEntries = hasQuery ? visibleEntries : entries;

      elements.searchStatus.textContent = formatSearchStatus(visibleEntries.length, entries.length);

      if (!entries.length) {
        elements.savedList.innerHTML = "";
        elements.emptyState.classList.remove("is-hidden");
        elements.noResults.classList.add("is-hidden");
        return;
      }

      if (hasQuery && !visibleEntries.length) {
        elements.savedList.innerHTML = "";
        elements.emptyState.classList.add("is-hidden");
        elements.noResults.classList.remove("is-hidden");
        return;
      }

      elements.emptyState.classList.add("is-hidden");
      elements.noResults.classList.add("is-hidden");
      const capped = displayEntries.slice(0, LIST_LIMIT);
      elements.savedList.innerHTML = capped.map(buildSavedItemMarkup).join("");

      if (displayEntries.length > LIST_LIMIT) {
        elements.savedList.innerHTML += hasQuery
          ? `<p class="list-overflow">Showing ${LIST_LIMIT} of ${displayEntries.length} matches. Refine your search to narrow down.</p>`
          : `<p class="list-overflow">Showing ${LIST_LIMIT} recent words. Type to search or open Vault to browse everything.</p>`;
      }
    }

    function findEntry(id) {
      return state.savedEntries.find((entry) => entry.id === id) || null;
    }

    function onMeaningToggleClick(event) {
      const toggleBtn = event.target.closest(".meaning-toggle");
      if (!toggleBtn) return;
      event.preventDefault();
      event.stopPropagation();
      const isOpen = toggleBtn.getAttribute("aria-expanded") === "true";
      toggleBtn.setAttribute("aria-expanded", isOpen ? "false" : "true");
      const panel = toggleBtn.nextElementSibling;
      if (panel && panel.classList.contains("meaning-expand")) {
        panel.classList.toggle("is-open", !isOpen);
      }
    }

    async function onSavedListClick(event) {
      const toggleBtn = event.target.closest(".meaning-toggle");
      if (toggleBtn) {
        onMeaningToggleClick(event);
        return;
      }

      const audioBtn = event.target.closest(".audio-btn");
      if (audioBtn) {
        event.preventDefault();
        event.stopPropagation();
        const entry = findEntry(audioBtn.closest("[data-id]")?.dataset.id);
        if (entry && typeof store.playLodAudio === "function") {
          store.playLodAudio(entry);
        }
        return;
      }

      const button = event.target.closest("button[data-action]");
      if (!button || button.disabled) return;

      if (button.dataset.action === "toggle-note") {
        const noteBody = button.closest(".note-section")?.querySelector(".note-body");
        if (noteBody) {
          ctx.current.showNoteBody(noteBody);
          noteBody.querySelector(".note-input")?.focus();
        }
        return;
      }

      const entry = findEntry(button.dataset.id);
      if (!entry) return;

      button.disabled = true;

      try {
        if (button.dataset.action === "remove") {
          await ctx.deleteUndo.deleteEntry(entry);
        } else if (button.dataset.action === "toggle-favorite") {
          const savedEntry = await store.toggleList(entry, "favorite");
          ctx.showActionFeedback(typeof store.describeListAction === "function"
            ? store.describeListAction(entry, "favorite", savedEntry)
            : `Updated ${entry.word}.`);
        } else if (button.dataset.action === "toggle-study") {
          const savedEntry = await store.toggleList(entry, "study");
          ctx.showActionFeedback(typeof store.describeListAction === "function"
            ? store.describeListAction(entry, "study", savedEntry)
            : `Updated ${entry.word}.`);
        }

        await renderSavedList();
      } catch {
        ctx.showActionFeedback("Could not update your vault.", "error");
      } finally {
        button.disabled = false;
      }
    }

    function onSavedListInput(event) {
      const textarea = event.target.closest("textarea[data-note-id]");
      if (!textarea) return;
      ctx.noteAutosave.markDirty(textarea);
    }

    function onSavedListChange(event) {
      const textarea = event.target.closest("textarea[data-note-id]");
      if (!textarea) return;
      ctx.noteAutosave.commit(textarea);
    }

    function onSavedListFocusOut(event) {
      const textarea = event.target.closest("textarea[data-note-id]");
      if (!textarea) return;
      ctx.noteAutosave.commit(textarea);
    }

    function onSearchInput(event) {
      state.searchQuery = event.target.value || "";
      renderList();
    }

    function openFlashcards() {
      chromeApi.tabs.create({ url: chromeApi.runtime.getURL("pages/flashcards.html") });
    }

    function openPreview() {
      chromeApi.tabs.create({ url: chromeApi.runtime.getURL("pages/preview.html") });
    }

    return {
      renderSavedList,
      renderList,
      formatSearchStatus,
      onSavedListClick,
      onSavedListInput,
      onSavedListChange,
      onSavedListFocusOut,
      onSearchInput,
      openFlashcards,
      openPreview,
      onMeaningToggleClick
    };
  }

  globalThis.LodVaultPopupList = {
    create: createListModule
  };
})();
