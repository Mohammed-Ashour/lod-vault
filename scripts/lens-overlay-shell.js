(() => {
  const ROOT_ID = "lodvault-lens-overlay-root";

  function createShell(handlers = {}) {
    function getRoot() {
      return document.getElementById(ROOT_ID);
    }

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

      root.addEventListener("click", (event) => {
        const closeButton = event.target.closest(".lodvault-lens-close, .lodvault-lens-backdrop");
        if (closeButton) {
          handlers.onClose?.();
          return;
        }

        const suggestionButton = event.target.closest(".lodvault-lens-suggestion[data-query]");
        if (suggestionButton) {
          handlers.onSuggestion?.({
            query: suggestionButton.dataset.query || "",
            entryId: suggestionButton.dataset.entryId || "",
            url: suggestionButton.dataset.url || ""
          });
          return;
        }

        const candidateButton = event.target.closest(".lodvault-lens-candidate[data-entry-id]");
        if (candidateButton?.dataset.entryId) {
          handlers.onCandidate?.(candidateButton.dataset.entryId);
          return;
        }

        const saveButton = event.target.closest(".lodvault-lens-save[data-list]");
        if (saveButton) {
          handlers.onSaveToggle?.(saveButton.dataset.list || "");
          return;
        }

        const meaningToggle = event.target.closest(".meaning-toggle");
        if (meaningToggle) {
          const isOpen = meaningToggle.getAttribute("aria-expanded") === "true";
          meaningToggle.setAttribute("aria-expanded", isOpen ? "false" : "true");
          const panel = meaningToggle.nextElementSibling;
          if (panel?.classList.contains("meaning-expand")) {
            panel.classList.toggle("is-open", !isOpen);
          }
          return;
        }

        const accordionHeader = event.target.closest(".lodvault-lens-accordion-header");
        if (accordionHeader) {
          const item = accordionHeader.closest(".lodvault-lens-accordion-item");
          if (item) {
            item.classList.toggle("lodvault-lens-accordion-open");
            renderBulkAccordionToggleState();
          }
          return;
        }

        const sentenceCandidate = event.target.closest(".lodvault-lens-sentence-candidate");
        if (sentenceCandidate?.classList.contains("lodvault-lens-sentence-suggestion")) {
          handlers.onSentenceSuggestion?.({
            query: sentenceCandidate.dataset.query || "",
            entryId: sentenceCandidate.dataset.entryId || "",
            url: sentenceCandidate.dataset.url || ""
          });
          return;
        }

        if (sentenceCandidate?.dataset.entryId) {
          handlers.onSentenceCandidate?.({
            wordIdx: Number.parseInt(sentenceCandidate.dataset.wordIdx, 10),
            entryId: sentenceCandidate.dataset.entryId || ""
          });
          return;
        }

        const sentenceSaveBtn = event.target.closest(".lodvault-lens-sentence-save[data-list]");
        if (sentenceSaveBtn) {
          handlers.onSentenceSaveToggle?.({
            wordIdx: Number.parseInt(sentenceSaveBtn.dataset.wordIdx, 10),
            listName: sentenceSaveBtn.dataset.list || ""
          });
          return;
        }

        const bulkStudyBtn = event.target.closest(".lodvault-lens-bulk-study");
        if (bulkStudyBtn) {
          handlers.onBulkStudy?.();
          return;
        }

        const bulkToggleBtn = event.target.closest(".lodvault-lens-bulk-toggle");
        if (bulkToggleBtn) {
          const isExpanded = bulkToggleBtn.getAttribute("aria-pressed") === "true";
          toggleAllAccordion(!isExpanded);
          return;
        }

        const wordChip = event.target.closest(".lodvault-lens-word-chip[data-word-idx]");
        if (wordChip) {
          const idx = wordChip.dataset.wordIdx;
          const accordionItem = root.querySelector(`.lodvault-lens-accordion-item[data-word-idx="${idx}"]`);
          if (accordionItem) {
            accordionItem.classList.add("lodvault-lens-accordion-open");
            renderBulkAccordionToggleState();
            accordionItem.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
        }
      });

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && getRoot()?.classList.contains("is-visible")) {
          handlers.onClose?.();
        }
      });

      document.documentElement.appendChild(root);
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

      const padding = 12;
      const gap = 10;
      const panelRect = panel.getBoundingClientRect();
      const width = Math.max(panelRect.width || panel.offsetWidth || 0, 300);
      const height = Math.max(panelRect.height || panel.offsetHeight || 0, 220);
      const minLeft = window.scrollX + padding;
      const maxLeft = window.scrollX + window.innerWidth - width - padding;
      const minTop = window.scrollY + padding;
      const maxTop = window.scrollY + window.innerHeight - height - padding;
      let left = rect.left + window.scrollX;
      let top = rect.bottom + window.scrollY + gap;

      left = Math.min(Math.max(left, minLeft), Math.max(minLeft, maxLeft));
      if (top > maxTop) {
        top = rect.top + window.scrollY - height - gap;
      }
      top = Math.min(Math.max(top, minTop), Math.max(minTop, maxTop));

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

    function renderWordSavedState(savedEntry) {
      const root = ensureRoot();
      const favoriteButton = root.querySelector('.lodvault-lens-save[data-list="favorite"]');
      const studyButton = root.querySelector('.lodvault-lens-save[data-list="study"]');
      const badge = root.querySelector(".lodvault-lens-saved");

      badge.classList.toggle("is-hidden", !savedEntry);
      favoriteButton.querySelector(".toggle-pill-icon").textContent = savedEntry?.favorite ? "★" : "☆";
      studyButton.querySelector(".toggle-pill-icon").textContent = savedEntry?.study ? "✓" : "○";
      favoriteButton.classList.toggle("is-active", Boolean(savedEntry?.favorite));
      studyButton.classList.toggle("is-active", Boolean(savedEntry?.study));
      favoriteButton.setAttribute("aria-pressed", savedEntry?.favorite ? "true" : "false");
      studyButton.setAttribute("aria-pressed", savedEntry?.study ? "true" : "false");
    }

    function renderWordEntry({ entry, savedEntry, store }) {
      const root = ensureRoot();
      const result = root.querySelector(".lodvault-lens-result");
      const candidates = root.querySelector(".lodvault-lens-candidates");
      const sentence = root.querySelector(".lodvault-lens-sentence");
      result.classList.toggle("is-hidden", !entry);
      candidates.classList.add("is-hidden");
      sentence.classList.add("is-hidden");
      root.classList.remove("lodvault-sentence-mode");
      root.querySelector(".lodvault-lens-candidate-list").innerHTML = "";

      if (!entry) {
        renderWordSavedState(savedEntry);
        positionPanel();
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

      renderWordSavedState(savedEntry);
      positionPanel();
    }

    function renderCandidates({ candidates, query, store, renderers }) {
      const root = ensureRoot();
      root.querySelector(".lodvault-lens-result").classList.add("is-hidden");
      root.querySelector(".lodvault-lens-sentence").classList.add("is-hidden");
      root.classList.remove("lodvault-sentence-mode");
      const candidatesSection = root.querySelector(".lodvault-lens-candidates");
      const list = root.querySelector(".lodvault-lens-candidate-list");
      candidatesSection.classList.remove("is-hidden");
      root.querySelector(".lodvault-lens-label").textContent = "Choose a match";
      list.innerHTML = renderers.renderCandidatesMarkup(candidates, store);
      setStatus(`Found ${candidates.length} matches for "${query}".`);
      positionPanel();
    }

    function renderSuggestions({ suggestions, query, store, renderers }) {
      const root = ensureRoot();
      root.querySelector(".lodvault-lens-result").classList.add("is-hidden");
      root.querySelector(".lodvault-lens-sentence").classList.add("is-hidden");
      root.classList.remove("lodvault-sentence-mode");
      const candidatesSection = root.querySelector(".lodvault-lens-candidates");
      const list = root.querySelector(".lodvault-lens-candidate-list");
      candidatesSection.classList.remove("is-hidden");
      root.querySelector(".lodvault-lens-label").textContent = `Did you mean… (${query})`;
      list.innerHTML = renderers.renderSuggestionsMarkup(suggestions, store);
      setStatus(`No exact LOD match found for "${query}".`);
      positionPanel();
    }

    function showSentenceMode() {
      const root = ensureRoot();
      root.querySelector(".lodvault-lens-result").classList.add("is-hidden");
      root.querySelector(".lodvault-lens-candidates").classList.add("is-hidden");
      root.querySelector(".lodvault-lens-sentence").classList.remove("is-hidden");
      root.classList.add("lodvault-sentence-mode");
      positionPanel();
    }

    function renderSentenceLoading(wordCount) {
      const root = ensureRoot();
      root.querySelector(".lodvault-lens-sentence").innerHTML = `<p class="lodvault-lens-sentence-loading">Looking up ${wordCount} words…</p>`;
      showSentenceMode();
    }

    function renderSentenceError(message) {
      const root = ensureRoot();
      root.querySelector(".lodvault-lens-sentence").innerHTML = `<p class="lodvault-lens-accordion-hint">${message}</p>`;
      showSentenceMode();
    }

    function renderSentence(markup) {
      const root = ensureRoot();
      root.querySelector(".lodvault-lens-sentence").innerHTML = markup;
      showSentenceMode();
      renderBulkAccordionToggleState();
    }

    function getSentenceOpenWordIndexes() {
      const root = getRoot();
      if (!root) return [];
      return Array.from(root.querySelectorAll(".lodvault-lens-accordion-item.lodvault-lens-accordion-open"))
        .map((item) => item.dataset.wordIdx)
        .filter((value) => value != null);
    }

    function renderBulkAccordionToggleState() {
      const root = getRoot();
      if (!root) return;
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

    return {
      ensureRoot,
      show,
      close,
      setStatus,
      setBusy,
      renderWordEntry,
      renderCandidates,
      renderSuggestions,
      renderSentenceLoading,
      renderSentenceError,
      renderSentence,
      getSentenceOpenWordIndexes
    };
  }

  globalThis.LodVaultLensOverlayShell = {
    createShell
  };
})();
