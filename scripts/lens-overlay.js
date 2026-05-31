(() => {
  const lookup = globalThis.LodWrapperLensLookup;
  const store = globalThis.LodWrapperStore;
  if (!lookup || !store) return;

  const ROOT_ID = "lodvault-lens-overlay-root";
  const MAX_SENTENCE_WORDS = 50;
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

  function escHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getPrimaryTranslation(entry) {
    if (!entry?.translations) return "";
    for (const lang of ["en", "fr", "de"]) {
      if (entry.translations[lang]) {
        const val = entry.translations[lang];
        const first = val.split(" · ")[0];
        const trimmed = first.split(";")[0].split(",")[0].trim();
        return trimmed || first;
      }
    }
    return "";
  }

  function getSentenceWordCount(text) {
    return lookup.splitSentence(text).filter((token) => token.isWord).length;
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
        <div class="lodvault-lens-sentence is-hidden"></div>
      </section>
    `;

    document.documentElement.appendChild(root);

    root.addEventListener("click", (event) => {
      const closeButton = event.target.closest(".lodvault-lens-close, .lodvault-lens-backdrop");
      if (closeButton) {
        close();
        return;
      }

      const suggestionButton = event.target.closest(".lodvault-lens-suggestion[data-query]");
      if (suggestionButton) {
        openSuggestion({
          query: suggestionButton.dataset.query || "",
          entryId: suggestionButton.dataset.entryId || "",
          url: suggestionButton.dataset.url || ""
        });
        return;
      }

      const candidateButton = event.target.closest(".lodvault-lens-candidate[data-entry-id]");
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
        return;
      }

      // Sentence mode: accordion header toggle
      const accordionHeader = event.target.closest(".lodvault-lens-accordion-header");
      if (accordionHeader) {
        const item = accordionHeader.closest(".lodvault-lens-accordion-item");
        if (item) {
          item.classList.toggle("lodvault-lens-accordion-open");
          renderBulkAccordionToggleState();
        }
        return;
      }

      // Sentence mode: candidate disambiguation
      const sentenceCandidate = event.target.closest(".lodvault-lens-sentence-candidate");
      if (sentenceCandidate?.dataset.entryId) {
        resolveSentenceCandidate(sentenceCandidate);
        return;
      }

      // Sentence mode: suggestion resolution
      const sentenceSuggestion = event.target.closest(".lodvault-lens-sentence-suggestion");
      if (sentenceSuggestion) {
        openSuggestion({
          query: sentenceSuggestion.dataset.query || "",
          entryId: sentenceSuggestion.dataset.entryId || "",
          url: sentenceSuggestion.dataset.url || ""
        });
        return;
      }

      // Sentence mode: save toggle per word
      const sentenceSaveBtn = event.target.closest(".lodvault-lens-sentence-save[data-list]");
      if (sentenceSaveBtn) {
        toggleSentenceWordList(sentenceSaveBtn);
        return;
      }

      // Sentence mode: bulk actions
      const bulkStudyBtn = event.target.closest(".lodvault-lens-bulk-study");
      if (bulkStudyBtn) {
        toggleBulkStudyFound();
        return;
      }

      const bulkToggleBtn = event.target.closest(".lodvault-lens-bulk-toggle");
      if (bulkToggleBtn) {
        const isExpanded = bulkToggleBtn.getAttribute("aria-pressed") === "true";
        toggleAllAccordion(!isExpanded);
        return;
      }

      // Sentence word chip click → scroll to accordion item
      const wordChip = event.target.closest(".lodvault-lens-word-chip[data-word-idx]");
      if (wordChip) {
        const idx = wordChip.dataset.wordIdx;
        const accordionItem = root.querySelector(`.lodvault-lens-accordion-item[data-word-idx="${idx}"]`);
        if (accordionItem) {
          accordionItem.classList.add("lodvault-lens-accordion-open");
          renderBulkAccordionToggleState();
          accordionItem.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
        return;
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
    root.classList.remove("lodvault-sentence-mode");
    const sentencePanel = root.querySelector(".lodvault-lens-sentence");
    if (sentencePanel) {
      sentencePanel.classList.add("is-hidden");
      sentencePanel.innerHTML = "";
    }
    clearSentenceState();
  }

  function setBusy(isBusy) {
    const root = ensureRoot();
    root.querySelectorAll([
      ".lodvault-lens-save",
      ".lodvault-lens-sentence-save",
      ".lodvault-lens-bulk-study",
      ".lodvault-lens-bulk-toggle",
      ".lodvault-lens-sentence-candidate"
    ].join(", ")).forEach((button) => {
      button.disabled = Boolean(isBusy);
    });
  }

  function state() {
    const root = ensureRoot();
    return root.__lodvaultLensState || (root.__lodvaultLensState = {
      entry: null,
      savedEntry: null,
      sentence: null
    });
  }

  function clearSentenceState() {
    state().sentence = null;
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
    const sentence = root.querySelector(".lodvault-lens-sentence");
    result.classList.toggle("is-hidden", !entry);
    candidates.classList.add("is-hidden");
    sentence.classList.add("is-hidden");
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
    root.querySelector(".lodvault-lens-sentence").classList.add("is-hidden");
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
    setStatus(`Found ${candidates.length} matches for "${query}".`);
  }

  function renderSuggestions(suggestions, query) {
    const root = ensureRoot();
    root.querySelector(".lodvault-lens-result").classList.add("is-hidden");
    root.querySelector(".lodvault-lens-sentence").classList.add("is-hidden");
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
    setStatus(`No exact LOD match found for "${query}".`);
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
      setStatus(entry ? `Found "${entry.word}".` : "Could not load this LOD entry.");
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
        ? `Saved "${currentState.entry.word}".`
        : `Removed "${currentState.entry.word}" from your vault.`);
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

  /* ──────────────────────────────────────────────────
     Sentence mode rendering
     ────────────────────────────────────────────────── */

  function showSingleWordMode() {
    const root = ensureRoot();
    root.querySelector(".lodvault-lens-sentence").classList.add("is-hidden");
    root.classList.remove("lodvault-sentence-mode");
  }

  function showSentenceMode() {
    const root = ensureRoot();
    root.querySelector(".lodvault-lens-result").classList.add("is-hidden");
    root.querySelector(".lodvault-lens-candidates").classList.add("is-hidden");
    root.querySelector(".lodvault-lens-sentence").classList.remove("is-hidden");
    root.classList.add("lodvault-sentence-mode");
  }

  function wordStatusClass(status) {
    if (status === "resolved") return "found";
    if (status === "ambiguous") return "ambiguous";
    if (status === "error") return "error";
    return "not-found";
  }

  function renderSentence(sentenceResult) {
    const root = ensureRoot();
    const container = root.querySelector(".lodvault-lens-sentence");
    const { tokens, words } = sentenceResult;

    // Build sentence display: reconstruct from tokens, highlighting word tokens
    let sentenceHtml = "";
    let wordIdx = 0;
    for (const token of tokens) {
      if (token.isWord) {
        const wordResult = words[wordIdx];
        const statusClass = wordResult
          ? wordStatusClass(wordResult.status)
          : "not-found";
        sentenceHtml += `<span class="lodvault-lens-word-chip ${escHtml(statusClass)}" data-word-idx="${wordIdx}">${escHtml(token.text)}</span>`;
        wordIdx++;
      } else {
        sentenceHtml += escHtml(token.text);
      }
    }

    // Build accordion items for each word
    let accordionHtml = "";
    wordIdx = 0;
    for (const token of tokens) {
      if (!token.isWord) continue;
      const w = words[wordIdx];
      if (!w) { wordIdx++; continue; }

      const statusClass = wordStatusClass(w.status);
      const translation = w.status === "resolved" ? getPrimaryTranslation(w.entry) : "";

      let bodyHtml = "";
      if (w.status === "resolved" && w.entry) {
        const meaningsHtml = store.buildMeaningCollapsibleMarkup(w.entry) || "";
        const exampleHtml = w.entry.example
          ? `<p class="lodvault-lens-example">${escHtml(w.entry.example)}</p>`
          : "";
        bodyHtml = `
          <div class="lodvault-lens-meanings">${meaningsHtml}</div>
          ${exampleHtml}
          <div class="lodvault-lens-actions">
            <button type="button" class="lodvault-lens-sentence-save toggle-pill toggle-fav" data-list="favorite" data-word-idx="${wordIdx}" data-entry-id="${escHtml(w.entry.id || "")}" aria-pressed="false">
              <span class="toggle-pill-icon">☆</span>
              <span class="toggle-pill-label">Fav</span>
            </button>
            <button type="button" class="lodvault-lens-sentence-save toggle-pill toggle-study" data-list="study" data-word-idx="${wordIdx}" data-entry-id="${escHtml(w.entry.id || "")}" aria-pressed="false">
              <span class="toggle-pill-icon">○</span>
              <span class="toggle-pill-label">Study</span>
            </button>
            <a class="lodvault-lens-open" href="${escHtml(w.entry.url || "https://lod.lu")}" target="_blank" rel="noreferrer">LOD</a>
          </div>`;
      } else if (w.status === "ambiguous" && w.candidates?.length) {
        const candidateListHtml = w.candidates.slice(0, 5).map((c) => `
          <button type="button" class="lodvault-lens-sentence-candidate" data-word-idx="${wordIdx}" data-entry-id="${escHtml(c.id)}">
            <strong>${escHtml(c.word || c.id)}</strong>
            <span>${escHtml([c.pos, c.id].filter(Boolean).join(" · "))}</span>
          </button>
        `).join("");
        bodyHtml = `<p class="lodvault-lens-accordion-hint">Choose the right meaning:</p>${candidateListHtml}`;
      } else if (w.status === "not-found" && w.suggestions?.length) {
        const suggestionListHtml = w.suggestions.slice(0, 3).map((s) => `
          <button type="button" class="lodvault-lens-sentence-candidate lodvault-lens-sentence-suggestion"
            data-word-idx="${wordIdx}"
            data-query="${escHtml(s.word || "")}"
            data-entry-id="${escHtml(s.entryId || "")}"
            data-url="${escHtml(s.url || "")}">
            <strong>${escHtml(s.word || "")}</strong>
            <span>${escHtml(s.entryId ? "Open LOD entry" : "Try lookup")}</span>
          </button>
        `).join("");
        bodyHtml = `<p class="lodvault-lens-accordion-hint">No exact match. Did you mean…</p>${suggestionListHtml}`;
      } else if (w.status === "not-found") {
        bodyHtml = `<p class="lodvault-lens-accordion-hint">No LOD match for "${escHtml(w.word)}".</p>`;
      } else if (w.status === "error") {
        bodyHtml = `<p class="lodvault-lens-accordion-hint">Lookup failed for "${escHtml(w.word)}".</p>`;
      }

      const posLabel = w.status === "resolved" && w.entry?.pos
        ? w.entry.pos + (w.entry.inflection ? ` · ${w.entry.inflection}` : "")
        : w.status === "ambiguous"
          ? `${w.candidates.length} matches`
          : w.status === "not-found"
            ? "not found"
            : "—";

      accordionHtml += `
        <div class="lodvault-lens-accordion-item${wordIdx === 0 ? " lodvault-lens-accordion-open" : ""}" data-word-idx="${wordIdx}">
          <div class="lodvault-lens-accordion-header">
            <span class="lodvault-lens-ai-status lodvault-lens-ai-${escHtml(statusClass)}"></span>
            <span class="lodvault-lens-ai-word">${escHtml(w.word)}</span>
            <span class="lodvault-lens-ai-pos">${escHtml(posLabel)}</span>
            ${w.status === "resolved" ? `<span class="lodvault-lens-ai-quick">${escHtml(translation)}</span>` : ""}
            <span class="lodvault-lens-ai-arrow">▶</span>
          </div>
          <div class="lodvault-lens-accordion-body">
            <div class="lodvault-lens-accordion-inner">
              ${bodyHtml}
            </div>
          </div>
        </div>`;

      wordIdx++;
    }

    const resolvedWords = words.filter((word) => word.status === "resolved" && word.entry);
    const bulkStudyActive = resolvedWords.length > 0
      && resolvedWords.every((word) => Boolean(word._savedEntry?.study));

    container.innerHTML = `
      <div class="lodvault-lens-sentence-block">
        <div class="lodvault-lens-sentence-text">${sentenceHtml}</div>
      </div>
      <div class="lodvault-lens-sentence-bulk">
        <button type="button" class="lodvault-lens-bulk-study toggle-pill toggle-study${bulkStudyActive ? " is-active" : ""}" aria-pressed="${bulkStudyActive ? "true" : "false"}"${resolvedWords.length ? "" : " disabled"}>
          <span class="toggle-pill-icon">${bulkStudyActive ? "✓" : "○"}</span>
          <span class="toggle-pill-label">Study all</span>
        </button>
        <button type="button" class="lodvault-lens-bulk-toggle toggle-pill" aria-pressed="false">
          <span class="toggle-pill-icon"><svg viewBox="0 0 10 10"><line x1="5" y1="1" x2="5" y2="9"/><line x1="1" y1="5" x2="9" y2="5"/></svg></span>
          <span class="toggle-pill-label">Expand all</span>
        </button>
      </div>
      <div class="lodvault-lens-sentence-words">${accordionHtml}</div>
    `;

    showSentenceMode();
    renderBulkAccordionToggleState();

    // Sync saved states for resolved entries
    syncSentenceSavedStates(words);
  }

  async function syncSentenceSavedStates(words) {
    for (const [wordIdx, w] of words.entries()) {
      if (w.status === "resolved" && w.entry?.id) {
        try {
          const savedEntry = await store.getEntry(w.entry.id);
          w._savedEntry = savedEntry;
          renderSentenceWordSavedState(wordIdx, w);
        } catch {
          w._savedEntry = null;
          renderSentenceWordSavedState(wordIdx, w);
        }
      }
    }
    renderBulkStudySavedState(words);
  }

  function getResolvedSentenceWords(words = state().sentence?.words) {
    return Array.isArray(words)
      ? words.filter((word) => word?.status === "resolved" && word.entry?.id)
      : [];
  }

  function isBulkStudyActive(words = state().sentence?.words) {
    const resolvedWords = getResolvedSentenceWords(words);
    return resolvedWords.length > 0 && resolvedWords.every((word) => Boolean(word._savedEntry?.study));
  }

  function renderBulkStudySavedState(words = state().sentence?.words) {
    const root = ensureRoot();
    const button = root.querySelector(".lodvault-lens-bulk-study");
    if (!button) return;

    const resolvedWords = getResolvedSentenceWords(words);
    const active = resolvedWords.length > 0 && resolvedWords.every((word) => Boolean(word._savedEntry?.study));
    button.disabled = resolvedWords.length === 0;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.querySelector(".toggle-pill-icon").textContent = active ? "✓" : "○";
  }

  function renderSentenceWordSavedState(wordIdx, wordResult) {
    if (!wordResult?.entry?.id) return;
    const root = ensureRoot();
    const matchingItem = root.querySelector(`.lodvault-lens-accordion-item[data-word-idx="${wordIdx}"]`);
    if (!matchingItem) return;

    const favBtn = matchingItem.querySelector('.lodvault-lens-sentence-save[data-list="favorite"]');
    const studyBtn = matchingItem.querySelector('.lodvault-lens-sentence-save[data-list="study"]');

    if (favBtn) {
      favBtn.classList.toggle("is-active", Boolean(wordResult._savedEntry?.favorite));
      favBtn.setAttribute("aria-pressed", wordResult._savedEntry?.favorite ? "true" : "false");
      favBtn.querySelector(".toggle-pill-icon").textContent = wordResult._savedEntry?.favorite ? "★" : "☆";
    }
    if (studyBtn) {
      studyBtn.classList.toggle("is-active", Boolean(wordResult._savedEntry?.study));
      studyBtn.setAttribute("aria-pressed", wordResult._savedEntry?.study ? "true" : "false");
      studyBtn.querySelector(".toggle-pill-icon").textContent = wordResult._savedEntry?.study ? "✓" : "○";
    }

    renderBulkStudySavedState();
  }

  async function toggleSentenceWordList(button) {
    const wordIdx = parseInt(button.dataset.wordIdx, 10);
    const listName = button.dataset.list;
    const sentenceState = state().sentence?.words;
    if (!sentenceState || !sentenceState[wordIdx]?.entry) return;

    const entry = sentenceState[wordIdx].entry;
    setBusy(true);
    try {
      const savedEntry = await store.toggleList(entry, listName);
      sentenceState[wordIdx]._savedEntry = savedEntry;
      renderSentenceWordSavedState(wordIdx, sentenceState[wordIdx]);

      const listLabel = listName === "study" ? "Study" : "favorites";
      const isActive = Boolean(savedEntry?.[listName]);
      setStatus(isActive
        ? `Added "${entry.word}" to ${listLabel}.`
        : `Removed "${entry.word}" from ${listLabel}.`);
    } catch {
      setStatus("Could not update your vault right now.");
    } finally {
      setBusy(false);
    }
  }

  async function resolveSentenceCandidate(button) {
    const wordIdx = parseInt(button.dataset.wordIdx, 10);
    const entryId = button.dataset.entryId;
    if (isNaN(wordIdx) || !entryId) return;

    const sentenceState = state().sentence?.words;
    if (!sentenceState || !sentenceState[wordIdx]) return;

    setBusy(true);
    setStatus("Loading translation…");

    try {
      const entry = await lookup.fetchEntry(entryId, { fetch: lensFetch });
      if (entry) {
        sentenceState[wordIdx].status = "resolved";
        sentenceState[wordIdx].entry = entry;
        sentenceState[wordIdx].candidates = [];
        sentenceState[wordIdx]._savedEntry = entry?.id ? await store.getEntry(entry.id) : null;
        renderSentence({
          query: state().sentence?.query || "",
          tokens: state().sentence?.tokens || [],
          words: sentenceState
        });
        setStatus(`Resolved "${entry.word || sentenceState[wordIdx].word}".`);
      } else {
        setStatus("Could not load this LOD entry.");
      }
    } catch {
      setStatus("Could not load this LOD entry right now.");
    } finally {
      setBusy(false);
    }
  }

  function renderBulkAccordionToggleState() {
    const root = ensureRoot();
    const button = root.querySelector(".lodvault-lens-bulk-toggle");
    if (!button) return;

    const items = Array.from(root.querySelectorAll(".lodvault-lens-accordion-item"));
    const allExpanded = items.length > 0 && items.every((item) => item.classList.contains("lodvault-lens-accordion-open"));

    button.setAttribute("aria-pressed", allExpanded ? "true" : "false");
    button.classList.toggle("is-active", allExpanded);
    const icon = allExpanded
      ? '<svg viewBox="0 0 10 10"><line x1="1" y1="5" x2="9" y2="5"/></svg>'
      : '<svg viewBox="0 0 10 10"><line x1="5" y1="1" x2="5" y2="9"/><line x1="1" y1="5" x2="9" y2="5"/></svg>';
    button.querySelector(".toggle-pill-icon").innerHTML = icon;
    button.querySelector(".toggle-pill-label").textContent = allExpanded ? "Collapse all" : "Expand all";
  }

  function toggleAllAccordion(expand) {
    const root = ensureRoot();
    root.querySelectorAll(".lodvault-lens-accordion-item").forEach((item) => {
      item.classList.toggle("lodvault-lens-accordion-open", expand);
    });
    renderBulkAccordionToggleState();
  }

  async function toggleBulkStudyFound() {
    const sentenceState = state().sentence?.words;
    if (!sentenceState) return;

    const foundEntries = getResolvedSentenceWords(sentenceState);
    if (!foundEntries.length) return;

    setBusy(true);
    try {
      for (const word of foundEntries) {
        if (typeof word._savedEntry === "undefined") {
          word._savedEntry = await store.getEntry(word.entry.id);
        }
      }

      const shouldRemove = isBulkStudyActive(foundEntries);
      let changedCount = 0;

      for (const word of foundEntries) {
        try {
          const isActive = Boolean(word._savedEntry?.study);
          if ((shouldRemove && !isActive) || (!shouldRemove && isActive)) {
            continue;
          }

          word._savedEntry = await store.toggleList(word.entry, "study");
          changedCount++;
        } catch {
          // Continue with other entries.
        }
      }

      renderSentence({
        query: state().sentence?.query || "",
        tokens: state().sentence?.tokens || [],
        words: sentenceState
      });
      setStatus(changedCount
        ? `${shouldRemove ? "Removed" : "Added"} ${changedCount} word${changedCount === 1 ? "" : "s"} ${shouldRemove ? "from" : "to"} Study.`
        : shouldRemove
          ? "No found words were removed from Study."
          : "All found words are already in Study.");
    } finally {
      setBusy(false);
    }
  }

  /* ──────────────────────────────────────────────────
     Main entry point
     ────────────────────────────────────────────────── */

  async function openFromSelection(selectionText = "") {
    const query = lookup.normalizeSelection(selectionText || getCurrentSelectionText());
    const requestId = ++currentRequestId;
    const currentState = state();
    currentState.entry = null;
    currentState.savedEntry = null;
    currentState.sentence = null;

    ensureRoot();
    show();
    setBusy(true);

    if (!query) {
      renderEntry(null);
      setStatus("Select a word first.");
      setBusy(false);
      return;
    }

    // Determine if this is a sentence (multi-word) or single word
    if (lookup.isSentence(query)) {
      const wordCount = getSentenceWordCount(query);
      if (requestId !== currentRequestId) return;
      if (wordCount > MAX_SENTENCE_WORDS) {
        renderEntry(null);
        setStatus(`Select up to ${MAX_SENTENCE_WORDS} words for sentence lookup.`);
        setBusy(false);
        return;
      }

      await openSentenceMode(query, requestId, wordCount);
    } else {
      await openWordMode(query, requestId);
    }
  }

  async function openWordMode(query, requestId) {
    const currentState = state();

    showSingleWordMode();
    renderEntry(null);
    setStatus(`Searching LOD for "${query}"…`);

    try {
      const result = await lookup.lookup(query, { fetch: lensFetch });
      if (requestId !== currentRequestId) return;

      if (result.status === "not-found") {
        renderEntry(null);
        if (result.suggestions?.length) {
          renderSuggestions(result.suggestions, query);
        } else {
          setStatus(`No LOD match found for "${query}".`);
        }
        return;
      }

      if (result.status === "ambiguous") {
        renderCandidates(result.candidates.slice(0, 8), result.query);
        return;
      }

      currentState.savedEntry = result.entry?.id ? await store.getEntry(result.entry.id) : null;
      renderEntry(result.entry);
      setStatus(`Found "${result.entry?.word || query}".`);
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

  async function openSentenceMode(query, requestId, wordCount = getSentenceWordCount(query)) {
    const currentState = state();

    // Hide single-word panels
    const root = ensureRoot();
    root.querySelector(".lodvault-lens-result").classList.add("is-hidden");
    root.querySelector(".lodvault-lens-candidates").classList.add("is-hidden");

    const sentenceContainer = root.querySelector(".lodvault-lens-sentence");
    sentenceContainer.classList.remove("is-hidden");
    sentenceContainer.innerHTML = `<p class="lodvault-lens-sentence-loading">Looking up ${escHtml(wordCount)} words…</p>`;

    setStatus(`Looking up ${wordCount} words…`);

    try {
      const sentenceResult = await lookup.lookupSentence(query, { fetch: lensFetch });
      if (requestId !== currentRequestId) return;

      currentState.sentence = sentenceResult;

      renderSentence(sentenceResult);

      const total = sentenceResult.words.length;
      const found = sentenceResult.words.filter(w => w.status === "resolved").length;
      setStatus(`${found}/${total} words found.`);
    } catch {
      if (requestId !== currentRequestId) return;
      sentenceContainer.innerHTML = `<p class="lodvault-lens-accordion-hint">Sentence lookup failed. Try again.</p>`;
      setStatus("Sentence lookup failed. Try again.");
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
