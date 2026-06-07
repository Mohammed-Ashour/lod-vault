(() => {
  function createController({ lookup, store, lensFetch, sessions, shell, renderers, setBusy, setStatus }) {
    function getSentenceWords(session) {
      return Array.isArray(session?.data.sentence?.words) ? session.data.sentence.words : [];
    }

    function getActiveSentenceSession() {
      const session = sessions.getActive();
      return session?.isActive() && session.mode === "sentence" && session.data.sentence
        ? session
        : null;
    }

    function getResolvedWords(words = []) {
      return words.filter((word) => word?.status === "resolved" && word.entry?.id);
    }

    function isBulkStudyActive(words = []) {
      const resolvedWords = getResolvedWords(words);
      return resolvedWords.length > 0 && resolvedWords.every((word) => Boolean(word._savedEntry?.study));
    }

    function renderSession(session) {
      return session?.guard(() => {
        if (!session.data.sentence) {
          return;
        }

        shell.renderSentence(renderers.renderSentenceMarkup(session.data.sentence, store, {
          expandedWordIndexes: shell.getSentenceOpenWordIndexes()
        }));
      });
    }

    async function syncSavedStates(session) {
      const pending = getSentenceWords(session)
        .map((word, index) => ({ word, index }))
        .filter(({ word }) => word?.status === "resolved" && word.entry?.id);

      const savedEntries = await Promise.all(pending.map(async ({ word, index }) => {
        try {
          return { index, savedEntry: await store.getEntry(word.entry.id) };
        } catch {
          return { index, savedEntry: null };
        }
      }));

      if (!session?.guard(() => {
        for (const { index, savedEntry } of savedEntries) {
          if (session.data.sentence.words[index]) {
            session.data.sentence.words[index]._savedEntry = savedEntry;
          }
        }
      })) {
        return;
      }

      renderSession(session);
    }

    async function open(session, query, wordCount) {
      shell.renderSentenceLoading(wordCount);
      setStatus(`Looking up ${wordCount} words…`);

      try {
        const sentenceResult = await lookup.lookupSentence(query, { fetch: lensFetch });
        if (!session?.guard((activeSession) => {
          activeSession.data.sentence = sentenceResult;
        })) {
          return;
        }

        renderSession(session);

        const total = sentenceResult.words.length;
        const found = sentenceResult.words.filter((word) => word.status === "resolved").length;
        setStatus(`${found}/${total} words found.`);

        void syncSavedStates(session);
      } catch {
        if (!session?.isActive()) return;
        shell.renderSentenceError("Sentence lookup failed. Try again.");
        setStatus("Sentence lookup failed. Try again.");
      }
    }

    async function resolveCandidate(wordIdx, entryId) {
      const session = getActiveSentenceSession();
      if (!session || Number.isNaN(wordIdx) || !entryId) return;

      const targetWord = getSentenceWords(session)[wordIdx];
      if (!targetWord) return;

      setBusy(true);
      setStatus("Loading translation…");

      try {
        const entry = await lookup.fetchEntry(entryId, { fetch: lensFetch });
        if (!entry) return;

        const savedEntry = entry.id ? await store.getEntry(entry.id) : null;
        if (!session?.guard(() => {
          targetWord.status = "resolved";
          targetWord.entry = entry;
          targetWord.candidates = [];
          targetWord._savedEntry = savedEntry;
        })) {
          return;
        }

        renderSession(session);
        setStatus(`Resolved "${entry.word || targetWord.word}".`);
      } catch {
        if (!session.isActive()) return;
        setStatus("Could not load this LOD entry right now.");
      } finally {
        if (session.isActive()) {
          setBusy(false);
        }
      }
    }

    async function toggleWordList(wordIdx, listName) {
      const session = getActiveSentenceSession();
      if (!session || Number.isNaN(wordIdx)) return;

      const targetWord = getSentenceWords(session)[wordIdx];
      if (!targetWord?.entry) return;

      setBusy(true);
      try {
        const savedEntry = await store.toggleList(targetWord.entry, listName);
        if (!session?.guard(() => {
          targetWord._savedEntry = savedEntry;
        })) {
          return;
        }

        renderSession(session);

        const listLabel = listName === "study" ? "Study" : "favorites";
        const isActive = Boolean(savedEntry?.[listName]);
        setStatus(isActive
          ? `Added "${targetWord.entry.word}" to ${listLabel}.`
          : `Removed "${targetWord.entry.word}" from ${listLabel}.`);
      } catch {
        if (!session.isActive()) return;
        setStatus("Could not update your vault right now.");
      } finally {
        if (session.isActive()) {
          setBusy(false);
        }
      }
    }

    async function hydrateSavedEntries(words) {
      return Promise.all(words.map(async (word) => {
        if (typeof word._savedEntry !== "undefined") {
          return {
            word,
            savedEntry: word._savedEntry
          };
        }

        try {
          return {
            word,
            savedEntry: await store.getEntry(word.entry.id)
          };
        } catch {
          return {
            word,
            savedEntry: null
          };
        }
      }));
    }

    async function toggleBulkStudy() {
      const session = getActiveSentenceSession();
      if (!session) return;

      const resolvedWords = getResolvedWords(getSentenceWords(session));
      if (!resolvedWords.length) return;

      setBusy(true);
      try {
        const savedEntries = await hydrateSavedEntries(resolvedWords);
        if (!session?.guard(() => {
          for (const { word, savedEntry } of savedEntries) {
            word._savedEntry = savedEntry;
          }
        })) {
          return;
        }

        const shouldRemove = isBulkStudyActive(resolvedWords);
        let changedCount = 0;

        for (const word of resolvedWords) {
          const isActive = Boolean(word._savedEntry?.study);
          if ((shouldRemove && !isActive) || (!shouldRemove && isActive)) {
            continue;
          }

          try {
            word._savedEntry = await store.toggleList(word.entry, "study");
            changedCount += 1;
          } catch {
            // Keep going for the other resolved words.
          }

          if (!session.isActive()) {
            return;
          }
        }

        renderSession(session);
        setStatus(changedCount
          ? `${shouldRemove ? "Removed" : "Added"} ${changedCount} word${changedCount === 1 ? "" : "s"} ${shouldRemove ? "from" : "to"} Study.`
          : shouldRemove
            ? "No found words were removed from Study."
            : "All found words are already in Study.");
      } finally {
        if (session.isActive()) {
          setBusy(false);
        }
      }
    }

    async function syncActiveSentenceSavedStates() {
      const session = getActiveSentenceSession();
      if (!session) return;
      await syncSavedStates(session);
    }

    return {
      open,
      resolveCandidate,
      toggleWordList,
      toggleBulkStudy,
      syncActiveSentenceSavedStates
    };
  }

  globalThis.LodVaultLensSentenceMode = {
    createController
  };
})();
