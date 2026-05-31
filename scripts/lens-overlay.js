(() => {
  const lookup = globalThis.LodWrapperLensLookup;
  const store = globalThis.LodWrapperStore;
  if (!lookup || !store) return;

  const ROOT_ID = "lodvault-lens-overlay-root";
  let currentRequestId = 0;

  function getRoot() {
    return document.getElementById(ROOT_ID);
  }

  const lensFetch = typeof lookup.getFetchImplementation === "function"
    ? lookup.getFetchImplementation()
    : null;

  function getSelectionRect() {
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

    try {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) return null;
      return rect;
    } catch {
      return null;
    }
  }

  function getCurrentSelectionText() {
    return window.getSelection?.()?.toString?.() || "";
  }

  function ensureRoot() {
    let root = getRoot();
    if (root) return root;

    root = document.createElement("div");
    root.id = ROOT_ID;
    root.innerHTML = `
      <div class="lodvault-lens-backdrop"></div>
      <section class="lodvault-lens-panel" role="dialog" aria-label="LOD Lens">
        <button type="button" class="lodvault-lens-close" aria-label="Close">×</button>
        <div class="lodvault-lens-status">Loading…</div>
        <div class="lodvault-lens-result is-hidden">
          <div class="lodvault-lens-result-top">
            <div>
              <div class="lodvault-lens-title-row">
                <h2 class="lodvault-lens-word">—</h2>
                <span class="lodvault-lens-saved is-hidden">Saved</span>
              </div>
              <p class="lodvault-lens-meta"></p>
            </div>
            <a class="lodvault-lens-open" href="#" target="_blank" rel="noreferrer">LOD</a>
          </div>
          <div class="lodvault-lens-meanings"></div>
          <p class="lodvault-lens-example is-hidden"></p>
          <div class="lodvault-lens-actions">
            <button type="button" class="lodvault-lens-save toggle-pill toggle-fav" data-list="favorite" aria-pressed="false">
              <span class="toggle-pill-icon">☆</span>
              <span class="toggle-pill-label">Fav</span>
            </button>
            <button type="button" class="lodvault-lens-save toggle-pill toggle-study" data-list="study" aria-pressed="false">
              <span class="toggle-pill-icon">○</span>
              <span class="toggle-pill-label">Study</span>
            </button>
          </div>
        </div>
        <div class="lodvault-lens-candidates is-hidden">
          <p class="lodvault-lens-label">Choose a match</p>
          <div class="lodvault-lens-candidate-list"></div>
        </div>
      </section>
    `;

    document.documentElement.appendChild(root);

    root.addEventListener("click", (event) => {
      const closeButton = event.target.closest(".lodvault-lens-close, .lodvault-lens-backdrop");
      if (closeButton) {
        close();
        return;
      }

      const suggestionButton = event.target.closest("button[data-query]");
      if (suggestionButton) {
        openSuggestion({
          query: suggestionButton.dataset.query || "",
          entryId: suggestionButton.dataset.entryId || "",
          url: suggestionButton.dataset.url || ""
        });
        return;
      }

      const candidateButton = event.target.closest("button[data-entry-id]");
      if (candidateButton?.dataset.entryId) {
        resolveEntry(candidateButton.dataset.entryId);
        return;
      }

      const saveButton = event.target.closest(".lodvault-lens-save[data-list]");
      if (saveButton) {
        toggleList(saveButton.dataset.list);
        return;
      }

      const toggleButton = event.target.closest(".meaning-toggle");
      if (toggleButton) {
        const isOpen = toggleButton.getAttribute("aria-expanded") === "true";
        toggleButton.setAttribute("aria-expanded", isOpen ? "false" : "true");
        const panel = toggleButton.nextElementSibling;
        if (panel?.classList.contains("meaning-expand")) {
          panel.classList.toggle("is-open", !isOpen);
        }
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && getRoot()?.classList.contains("is-visible")) {
        close();
      }
    });

    return root;
  }

  function setStatus(message) {
    const root = ensureRoot();
    const status = root.querySelector(".lodvault-lens-status");
    status.textContent = message;
  }

  function positionPanel() {
    const root = ensureRoot();
    const panel = root.querySelector(".lodvault-lens-panel");
    const rect = getSelectionRect();

    if (!rect) {
      panel.style.left = "16px";
      panel.style.top = "16px";
      return;
    }

    const width = 300;
    const padding = 12;
    let left = rect.left + window.scrollX;
    let top = rect.bottom + window.scrollY + 10;

    left = Math.max(window.scrollX + padding, Math.min(left, window.scrollX + window.innerWidth - width - padding));
    if (top > window.scrollY + window.innerHeight - 220) {
      top = Math.max(window.scrollY + padding, rect.top + window.scrollY - 220);
    }

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function show() {
    const root = ensureRoot();
    root.classList.add("is-visible");
    positionPanel();
  }

  function close() {
    const root = getRoot();
    if (!root) return;
    root.classList.remove("is-visible");
  }

  function setBusy(isBusy) {
    const root = ensureRoot();
    root.querySelectorAll(".lodvault-lens-save").forEach((button) => {
      button.disabled = Boolean(isBusy);
    });
  }

  function state() {
    const root = ensureRoot();
    return root.__lodvaultLensState || (root.__lodvaultLensState = {
      entry: null,
      savedEntry: null
    });
  }

  function renderSavedState() {
    const root = ensureRoot();
    const currentState = state();
    const favoriteButton = root.querySelector('.lodvault-lens-save[data-list="favorite"]');
    const studyButton = root.querySelector('.lodvault-lens-save[data-list="study"]');
    const badge = root.querySelector('.lodvault-lens-saved');

    badge.classList.toggle("is-hidden", !currentState.savedEntry);
    favoriteButton.querySelector(".toggle-pill-icon").textContent = currentState.savedEntry?.favorite ? "★" : "☆";
    favoriteButton.querySelector(".toggle-pill-label").textContent = "Fav";
    studyButton.querySelector(".toggle-pill-icon").textContent = currentState.savedEntry?.study ? "✓" : "○";
    studyButton.querySelector(".toggle-pill-label").textContent = "Study";
    favoriteButton.classList.toggle("is-active", Boolean(currentState.savedEntry?.favorite));
    studyButton.classList.toggle("is-active", Boolean(currentState.savedEntry?.study));
    favoriteButton.setAttribute("aria-pressed", currentState.savedEntry?.favorite ? "true" : "false");
    studyButton.setAttribute("aria-pressed", currentState.savedEntry?.study ? "true" : "false");
  }

  function renderEntry(entry) {
    const root = ensureRoot();
    const currentState = state();
    currentState.entry = entry || null;

    const result = root.querySelector(".lodvault-lens-result");
    const candidates = root.querySelector(".lodvault-lens-candidates");
    result.classList.toggle("is-hidden", !entry);
    candidates.classList.add("is-hidden");
    root.querySelector(".lodvault-lens-candidate-list").innerHTML = "";

    if (!entry) {
      renderSavedState();
      return;
    }

    root.querySelector(".lodvault-lens-word").textContent = entry.word || "";
    root.querySelector(".lodvault-lens-meta").textContent = [entry.pos, entry.inflection].filter(Boolean).join(" · ");
    root.querySelector(".lodvault-lens-meanings").innerHTML = store.buildMeaningCollapsibleMarkup(entry) || "";
    root.querySelector(".lodvault-lens-open").href = entry.url || "https://lod.lu";

    const example = root.querySelector(".lodvault-lens-example");
    if (entry.example) {
      example.textContent = entry.example;
      example.classList.remove("is-hidden");
    } else {
      example.textContent = "";
      example.classList.add("is-hidden");
    }

    renderSavedState();
  }

  function renderCandidates(candidates, query) {
    const root = ensureRoot();
    root.querySelector(".lodvault-lens-result").classList.add("is-hidden");
    const candidatesSection = root.querySelector(".lodvault-lens-candidates");
    const list = root.querySelector(".lodvault-lens-candidate-list");
    candidatesSection.classList.remove("is-hidden");
    root.querySelector(".lodvault-lens-label").textContent = "Choose a match";
    list.innerHTML = candidates.map((candidate) => `
      <button type="button" class="lodvault-lens-candidate" data-entry-id="${store.escapeHtml(candidate.id)}">
        <span class="lodvault-lens-candidate-word">${store.escapeHtml(candidate.word || candidate.id)}</span>
        <span class="lodvault-lens-candidate-meta">${store.escapeHtml([candidate.pos, candidate.id].filter(Boolean).join(" · "))}</span>
      </button>
    `).join("");
    setStatus(`Found ${candidates.length} matches for “${query}”.`);
  }

  function renderSuggestions(suggestions, query) {
    const root = ensureRoot();
    root.querySelector(".lodvault-lens-result").classList.add("is-hidden");
    const candidatesSection = root.querySelector(".lodvault-lens-candidates");
    const list = root.querySelector(".lodvault-lens-candidate-list");
    candidatesSection.classList.remove("is-hidden");
    root.querySelector(".lodvault-lens-label").textContent = `Did you mean… (${query})`;
    list.innerHTML = suggestions.map((suggestion) => `
      <button
        type="button"
        class="lodvault-lens-candidate lodvault-lens-suggestion"
        data-query="${store.escapeHtml(suggestion.word || "")}"
        data-entry-id="${store.escapeHtml(suggestion.entryId || "")}"
        data-url="${store.escapeHtml(suggestion.url || "")}"
      >
        <span class="lodvault-lens-candidate-word">${store.escapeHtml(suggestion.word || "")}</span>
        <span class="lodvault-lens-candidate-meta">${store.escapeHtml(suggestion.entryId ? "Open this LOD entry" : "Try this lookup")}</span>
      </button>
    `).join("");
    setStatus(`No exact LOD match found for “${query}”.`);
  }

  async function syncSavedEntry() {
    const currentState = state();
    currentState.savedEntry = currentState.entry?.id ? await store.getEntry(currentState.entry.id) : null;
    renderSavedState();
  }

  async function resolveEntry(entryId) {
    const requestId = ++currentRequestId;
    setBusy(true);
    setStatus("Loading translation…");

    try {
      const entry = await lookup.fetchEntry(entryId, { fetch: lensFetch });
      if (requestId !== currentRequestId) return;
      state().savedEntry = entry?.id ? await store.getEntry(entry.id) : null;
      renderEntry(entry);
      setStatus(entry ? `Found “${entry.word}”.` : "Could not load this LOD entry.");
    } catch {
      if (requestId !== currentRequestId) return;
      renderEntry(null);
      setStatus("Could not load this LOD entry right now.");
    } finally {
      if (requestId === currentRequestId) {
        setBusy(false);
      }
    }
  }

  async function toggleList(listName) {
    const currentState = state();
    if (!currentState.entry) return;

    setBusy(true);
    try {
      currentState.savedEntry = await store.toggleList(currentState.entry, listName);
      renderSavedState();
      setStatus(currentState.savedEntry
        ? `Saved “${currentState.entry.word}”.`
        : `Removed “${currentState.entry.word}” from your vault.`);
    } catch {
      setStatus("Could not update your vault right now.");
    } finally {
      setBusy(false);
    }
  }

  async function openSuggestion(suggestion = {}) {
    const query = lookup.normalizeSelection(suggestion.query);
    if (!query) return;

    if (suggestion.entryId) {
      await resolveEntry(suggestion.entryId);
      return;
    }

    await openFromSelection(query);
  }

  async function openFromSelection(selectionText = "") {
    const query = lookup.normalizeSelection(selectionText || getCurrentSelectionText());
    const requestId = ++currentRequestId;
    const currentState = state();
    currentState.entry = null;
    currentState.savedEntry = null;

    ensureRoot();
    show();
    setBusy(true);
    setStatus(query ? `Searching LOD for “${query}”…` : "Select a word first.");
    renderEntry(null);

    if (!query) {
      setBusy(false);
      return;
    }

    try {
      const result = await lookup.lookup(query, { fetch: lensFetch });
      if (requestId !== currentRequestId) return;

      if (result.status === "not-found") {
        renderEntry(null);
        if (result.suggestions?.length) {
          renderSuggestions(result.suggestions, query);
        } else {
          setStatus(`No LOD match found for “${query}”.`);
        }
        return;
      }

      if (result.status === "ambiguous") {
        renderCandidates(result.candidates.slice(0, 8), result.query);
        return;
      }

      currentState.savedEntry = result.entry?.id ? await store.getEntry(result.entry.id) : null;
      renderEntry(result.entry);
      setStatus(`Found “${result.entry?.word || query}”.`);
    } catch {
      if (requestId !== currentRequestId) return;
      renderEntry(null);
      setStatus("LOD lookup failed. Try again.");
    } finally {
      if (requestId === currentRequestId) {
        setBusy(false);
      }
    }
  }

  globalThis.LodWrapperLensOverlay = {
    openFromSelection,
    close,
    syncSavedEntry
  };
})();
