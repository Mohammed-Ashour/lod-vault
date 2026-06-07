(() => {
  function createController({ lookup, store, sessions, renderers, shellNamespace, sentenceNamespace }) {
    const MAX_SENTENCE_WORDS = 50;
    const lensFetch = typeof lookup.getFetchImplementation === "function"
      ? lookup.getFetchImplementation()
      : null;

    let shell = null;
    let sentenceMode = null;

    function ensureShell() {
      if (shell) {
        return shell;
      }

      shell = shellNamespace.createShell({
        onClose: close,
        onSuggestion: openSuggestion,
        onCandidate: resolveEntry,
        onSaveToggle: toggleList,
        onSentenceCandidate({ wordIdx, entryId }) {
          void ensureSentenceMode().resolveCandidate(wordIdx, entryId);
        },
        onSentenceSuggestion: openSuggestion,
        onSentenceSaveToggle({ wordIdx, listName }) {
          void ensureSentenceMode().toggleWordList(wordIdx, listName);
        },
        onBulkStudy() {
          void ensureSentenceMode().toggleBulkStudy();
        }
      });

      return shell;
    }

    function ensureSentenceMode() {
      if (sentenceMode) {
        return sentenceMode;
      }

      sentenceMode = sentenceNamespace.createController({
        lookup,
        store,
        lensFetch,
        sessions,
        shell: ensureShell(),
        renderers,
        setBusy,
        setStatus
      });

      return sentenceMode;
    }

    function getCurrentSelectionText() {
      return window.getSelection?.()?.toString?.() || "";
    }

    function getSentenceWordCount(text) {
      return lookup.splitSentence(text).filter((token) => token.isWord).length;
    }

    function getSavedEntry(entry) {
      return entry?.id ? store.getEntry(entry.id) : Promise.resolve(null);
    }

    function setStatus(message) {
      ensureShell().setStatus(message);
    }

    function setBusy(isBusy) {
      ensureShell().setBusy(isBusy);
    }

    function updateWordSession(session, entry, savedEntry) {
      if (!session?.guard((activeSession) => {
        activeSession.data.entry = entry || null;
        activeSession.data.savedEntry = savedEntry || null;
        ensureShell().renderWordEntry({ entry, savedEntry, store });
      })) {
        return false;
      }

      return true;
    }

    function close() {
      sessions.close();
      ensureShell().close();
    }

    async function openWordMode(session, query) {
      updateWordSession(session, null, null);
      setStatus(`Searching LOD for "${query}"…`);

      try {
        const result = await lookup.lookup(query, { fetch: lensFetch });
        if (!session.isActive()) return;

        if (result.status === "not-found") {
          updateWordSession(session, null, null);
          if (result.suggestions?.length) {
            ensureShell().renderSuggestions({ suggestions: result.suggestions, query, store, renderers });
          } else {
            setStatus(`No LOD match found for "${query}".`);
          }
          return;
        }

        if (result.status === "ambiguous") {
          session.guard((activeSession) => {
            activeSession.data.entry = null;
            activeSession.data.savedEntry = null;
            ensureShell().renderCandidates({
              candidates: result.candidates.slice(0, 8),
              query: result.query,
              store,
              renderers
            });
          });
          return;
        }

        const savedEntry = await getSavedEntry(result.entry);
        if (!updateWordSession(session, result.entry, savedEntry)) return;

        setStatus(`Found "${result.entry?.word || query}".`);
      } catch {
        if (!updateWordSession(session, null, null)) return;
        setStatus("LOD lookup failed. Try again.");
      } finally {
        if (session.isActive()) {
          setBusy(false);
        }
      }
    }

    async function openSentenceMode(session, query, wordCount) {
      try {
        await ensureSentenceMode().open(session, query, wordCount);
      } finally {
        if (session.isActive()) {
          setBusy(false);
        }
      }
    }

    async function openFromSelection(selectionText = "") {
      const query = lookup.normalizeSelection(selectionText || getCurrentSelectionText());
      const mode = lookup.isSentence(query) ? "sentence" : "word";
      const session = sessions.createSession(query, mode);

      ensureShell().ensureRoot();
      ensureShell().show();
      setBusy(true);

      if (!query) {
        updateWordSession(session, null, null);
        setStatus("Select a word first.");
        setBusy(false);
        return;
      }

      if (mode === "sentence") {
        const wordCount = getSentenceWordCount(query);
        if (!session.isActive()) return;

        if (wordCount > MAX_SENTENCE_WORDS) {
          updateWordSession(session, null, null);
          setStatus(`Select up to ${MAX_SENTENCE_WORDS} words for sentence lookup.`);
          setBusy(false);
          return;
        }

        await openSentenceMode(session, query, wordCount);
        return;
      }

      await openWordMode(session, query);
    }

    async function resolveEntry(entryId) {
      const session = sessions.getActive();
      if (!session || !entryId) {
        return;
      }

      setBusy(true);
      setStatus("Loading translation…");

      try {
        const entry = await lookup.fetchEntry(entryId, { fetch: lensFetch });
        if (!session.isActive()) return;

        const savedEntry = await getSavedEntry(entry);
        if (!session.isActive()) return;

        session.mode = "word";
        if (!updateWordSession(session, entry, savedEntry)) return;
        setStatus(entry ? `Found "${entry.word}".` : "Could not load this LOD entry.");
      } catch {
        if (!updateWordSession(session, null, null)) return;
        setStatus("Could not load this LOD entry right now.");
      } finally {
        if (session.isActive()) {
          setBusy(false);
        }
      }
    }

    async function toggleList(listName) {
      const session = sessions.getActive();
      const entry = session?.data.entry;
      if (!session || !entry) {
        return;
      }

      setBusy(true);
      try {
        const savedEntry = await store.toggleList(entry, listName);
        if (!updateWordSession(session, entry, savedEntry)) return;

        setStatus(savedEntry
          ? `Saved "${entry.word}".`
          : `Removed "${entry.word}" from your vault.`);
      } catch {
        if (!session.isActive()) return;
        setStatus("Could not update your vault right now.");
      } finally {
        if (session.isActive()) {
          setBusy(false);
        }
      }
    }

    async function syncSavedEntry() {
      const session = sessions.getActive();
      if (!session) {
        return;
      }

      if (session.mode === "sentence") {
        await ensureSentenceMode().syncActiveSentenceSavedStates();
        return;
      }

      const entry = session.data.entry;
      if (!entry?.id) {
        return;
      }

      const savedEntry = await getSavedEntry(entry);
      updateWordSession(session, entry, savedEntry);
    }

    async function openSuggestion(suggestion = {}) {
      const query = lookup.normalizeSelection(suggestion.query);
      if (!query) {
        return;
      }

      if (suggestion.entryId) {
        await resolveEntry(suggestion.entryId);
        return;
      }

      await openFromSelection(query);
    }

    return {
      openFromSelection,
      close,
      syncSavedEntry
    };
  }

  globalThis.LodVaultLensController = {
    createController
  };
})();
