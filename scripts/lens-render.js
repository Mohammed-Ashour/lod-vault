(() => {
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getPrimaryTranslation(entry) {
    if (!entry?.translations) return "";

    for (const lang of ["en", "fr", "de"]) {
      if (!entry.translations[lang]) {
        continue;
      }

      const value = entry.translations[lang];
      const first = value.split(" · ")[0];
      const trimmed = first.split(";")[0].split(",")[0].trim();
      return trimmed || first;
    }

    return "";
  }

  function wordStatusClass(status) {
    if (status === "resolved") return "found";
    if (status === "ambiguous") return "ambiguous";
    if (status === "error") return "error";
    return "not-found";
  }

  function renderCandidatesMarkup(candidates, store) {
    return candidates.map((candidate) => `
      <button type="button" class="lodvault-lens-candidate" data-entry-id="${store.escapeHtml(candidate.id)}">
        <span class="lodvault-lens-candidate-word">${store.escapeHtml(candidate.word || candidate.id)}</span>
        <span class="lodvault-lens-candidate-meta">${store.escapeHtml([candidate.pos, candidate.id].filter(Boolean).join(" · "))}</span>
      </button>
    `).join("");
  }

  function renderSuggestionsMarkup(suggestions, store) {
    return suggestions.map((suggestion) => `
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
  }

  function renderSentenceMarkup(sentenceResult, store, options = {}) {
    const tokens = Array.isArray(sentenceResult?.tokens) ? sentenceResult.tokens : [];
    const words = Array.isArray(sentenceResult?.words) ? sentenceResult.words : [];
    const expandedWordIndexes = new Set(
      Array.isArray(options.expandedWordIndexes)
        ? options.expandedWordIndexes.map((value) => String(value))
        : []
    );

    let sentenceHtml = "";
    let wordIdx = 0;
    for (const token of tokens) {
      if (token.isWord) {
        const wordResult = words[wordIdx];
        const statusClass = wordResult ? wordStatusClass(wordResult.status) : "not-found";
        sentenceHtml += `<span class="lodvault-lens-word-chip ${escapeHtml(statusClass)}" data-word-idx="${wordIdx}">${escapeHtml(token.text)}</span>`;
        wordIdx += 1;
        continue;
      }

      sentenceHtml += escapeHtml(token.text);
    }

    let accordionHtml = "";
    wordIdx = 0;
    for (const token of tokens) {
      if (!token.isWord) continue;

      const wordResult = words[wordIdx];
      if (!wordResult) {
        wordIdx += 1;
        continue;
      }

      const statusClass = wordStatusClass(wordResult.status);
      const translation = wordResult.status === "resolved" ? getPrimaryTranslation(wordResult.entry) : "";
      const isExpanded = expandedWordIndexes.size
        ? expandedWordIndexes.has(String(wordIdx))
        : wordIdx === 0;

      let bodyHtml = "";
      if (wordResult.status === "resolved" && wordResult.entry) {
        const meaningsHtml = store.buildMeaningCollapsibleMarkup(wordResult.entry) || "";
        const exampleHtml = wordResult.entry.example
          ? `<p class="lodvault-lens-example">${escapeHtml(wordResult.entry.example)}</p>`
          : "";
        bodyHtml = `
          <div class="lodvault-lens-meanings">${meaningsHtml}</div>
          ${exampleHtml}
          <div class="lodvault-lens-actions">
            <button type="button" class="lodvault-lens-sentence-save toggle-pill toggle-fav${wordResult._savedEntry?.favorite ? " is-active" : ""}" data-list="favorite" data-word-idx="${wordIdx}" data-entry-id="${escapeHtml(wordResult.entry.id || "")}" aria-pressed="${wordResult._savedEntry?.favorite ? "true" : "false"}">
              <span class="toggle-pill-icon">${wordResult._savedEntry?.favorite ? "★" : "☆"}</span>
              <span class="toggle-pill-label">Fav</span>
            </button>
            <button type="button" class="lodvault-lens-sentence-save toggle-pill toggle-study${wordResult._savedEntry?.study ? " is-active" : ""}" data-list="study" data-word-idx="${wordIdx}" data-entry-id="${escapeHtml(wordResult.entry.id || "")}" aria-pressed="${wordResult._savedEntry?.study ? "true" : "false"}">
              <span class="toggle-pill-icon">${wordResult._savedEntry?.study ? "✓" : "○"}</span>
              <span class="toggle-pill-label">Study</span>
            </button>
            <a class="lodvault-lens-open" href="${escapeHtml(wordResult.entry.url || "https://lod.lu")}" target="_blank" rel="noreferrer">LOD</a>
          </div>`;
      } else if (wordResult.status === "ambiguous" && wordResult.candidates?.length) {
        const candidateListHtml = wordResult.candidates.slice(0, 5).map((candidate) => `
          <button type="button" class="lodvault-lens-sentence-candidate" data-word-idx="${wordIdx}" data-entry-id="${escapeHtml(candidate.id)}">
            <strong>${escapeHtml(candidate.word || candidate.id)}</strong>
            <span>${escapeHtml([candidate.pos, candidate.id].filter(Boolean).join(" · "))}</span>
          </button>
        `).join("");
        bodyHtml = `<p class="lodvault-lens-accordion-hint">Choose the right meaning:</p>${candidateListHtml}`;
      } else if (wordResult.status === "not-found" && wordResult.suggestions?.length) {
        const suggestionListHtml = wordResult.suggestions.slice(0, 3).map((suggestion) => `
          <button type="button" class="lodvault-lens-sentence-candidate lodvault-lens-sentence-suggestion"
            data-word-idx="${wordIdx}"
            data-query="${escapeHtml(suggestion.word || "")}"
            data-entry-id="${escapeHtml(suggestion.entryId || "")}"
            data-url="${escapeHtml(suggestion.url || "")}">
            <strong>${escapeHtml(suggestion.word || "")}</strong>
            <span>${escapeHtml(suggestion.entryId ? "Open LOD entry" : "Try lookup")}</span>
          </button>
        `).join("");
        bodyHtml = `<p class="lodvault-lens-accordion-hint">No exact match. Did you mean…</p>${suggestionListHtml}`;
      } else if (wordResult.status === "not-found") {
        bodyHtml = `<p class="lodvault-lens-accordion-hint">No LOD match for "${escapeHtml(wordResult.word)}".</p>`;
      } else if (wordResult.status === "error") {
        bodyHtml = `<p class="lodvault-lens-accordion-hint">Lookup failed for "${escapeHtml(wordResult.word)}".</p>`;
      }

      const posLabel = wordResult.status === "resolved" && wordResult.entry?.pos
        ? wordResult.entry.pos + (wordResult.entry.inflection ? ` · ${wordResult.entry.inflection}` : "")
        : wordResult.status === "ambiguous"
          ? `${wordResult.candidates.length} matches`
          : wordResult.status === "not-found"
            ? "not found"
            : "—";

      accordionHtml += `
        <div class="lodvault-lens-accordion-item${isExpanded ? " lodvault-lens-accordion-open" : ""}" data-word-idx="${wordIdx}">
          <div class="lodvault-lens-accordion-header">
            <span class="lodvault-lens-ai-status lodvault-lens-ai-${escapeHtml(statusClass)}"></span>
            <span class="lodvault-lens-ai-word">${escapeHtml(wordResult.word)}</span>
            <span class="lodvault-lens-ai-pos">${escapeHtml(posLabel)}</span>
            ${wordResult.status === "resolved" ? `<span class="lodvault-lens-ai-quick">${escapeHtml(translation)}</span>` : ""}
            <span class="lodvault-lens-ai-arrow">▶</span>
          </div>
          <div class="lodvault-lens-accordion-body">
            <div class="lodvault-lens-accordion-inner">
              ${bodyHtml}
            </div>
          </div>
        </div>`;

      wordIdx += 1;
    }

    const resolvedWords = words.filter((word) => word?.status === "resolved" && word.entry);
    const bulkStudyActive = resolvedWords.length > 0
      && resolvedWords.every((word) => Boolean(word._savedEntry?.study));

    return `
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
  }

  globalThis.LodVaultLensRender = {
    renderCandidatesMarkup,
    renderSuggestionsMarkup,
    renderSentenceMarkup
  };
})();
