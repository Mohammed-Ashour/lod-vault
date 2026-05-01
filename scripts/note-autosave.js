(() => {
  function normalizeNoteValue(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function createNoteAutosaveController(options = {}) {
    const timers = new Map();
    const getTimerKey = typeof options.getTimerKey === "function"
      ? options.getTimerKey
      : (textarea) => textarea?.dataset?.noteId || "default";
    const getActiveElement = typeof options.getActiveElement === "function"
      ? options.getActiveElement
      : () => typeof document !== "undefined" ? document.activeElement : null;
    const isBlocked = typeof options.isBlocked === "function"
      ? options.isBlocked
      : () => false;
    const saveNoteHandler = typeof options.saveNote === "function"
      ? options.saveNote
      : async (_noteId, value) => ({ note: normalizeNoteValue(value) });
    const setStatus = typeof options.setStatus === "function"
      ? options.setStatus
      : () => {};
    const onSaved = typeof options.onSaved === "function"
      ? options.onSaved
      : async () => {};
    const onError = typeof options.onError === "function"
      ? options.onError
      : async () => false;
    const shouldKeepScheduling = typeof options.shouldKeepScheduling === "function"
      ? options.shouldKeepScheduling
      : (textarea) => textarea?.isConnected ?? true;
    const getIdleMessage = typeof options.getIdleMessage === "function"
      ? options.getIdleMessage
      : ({ savedValue }) => savedValue ? "Saved with this word." : "Add a short note — it saves automatically.";
    const getSavingMessage = typeof options.getSavingMessage === "function"
      ? options.getSavingMessage
      : () => "Saving note…";
    const getSavedMessage = typeof options.getSavedMessage === "function"
      ? options.getSavedMessage
      : ({ savedEntry, changedSinceRequest }) => changedSinceRequest ? "Saving note…" : savedEntry?.note ? "Note saved." : "Note cleared.";
    const getErrorMessage = typeof options.getErrorMessage === "function"
      ? options.getErrorMessage
      : () => "Could not save note.";

    function getKey(textarea) {
      return String(getTimerKey(textarea) || "default");
    }

    function clear(textarea) {
      const timer = timers.get(getKey(textarea));
      if (!timer) return;
      clearTimeout(timer);
      timers.delete(getKey(textarea));
    }

    function clearAll() {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    }

    function schedule(textarea, delay = 500) {
      clear(textarea);
      const key = getKey(textarea);
      const timer = setTimeout(() => {
        timers.delete(key);
        commit(textarea);
      }, delay);
      timers.set(key, timer);
    }

    function markDirty(textarea, delay = 500) {
      if (!textarea || textarea.disabled || isBlocked(textarea)) return;
      textarea.dataset.dirty = "true";
      setStatus(textarea, getSavingMessage({ textarea }), "saving");
      schedule(textarea, delay);
    }

    async function commit(textarea) {
      if (!textarea || isBlocked(textarea)) return;

      clear(textarea);

      const noteId = textarea.dataset.noteId || "";
      if (!noteId || textarea.disabled) return;

      if (textarea.dataset.saving === "true") {
        textarea.dataset.resave = "true";
        return;
      }

      const requestValue = textarea.value;
      const requestNote = normalizeNoteValue(requestValue);
      const savedValue = textarea.dataset.savedValue || "";

      if (requestNote === savedValue) {
        if (getActiveElement() !== textarea) {
          textarea.value = savedValue;
        }
        textarea.dataset.dirty = "";
        setStatus(textarea, getIdleMessage({ textarea, savedValue }), "");
        return;
      }

      textarea.dataset.saving = "true";
      setStatus(textarea, getSavingMessage({ textarea }), "saving");

      try {
        const savedEntry = await saveNoteHandler(noteId, requestValue, textarea);
        const changedSinceRequest = normalizeNoteValue(textarea.value) !== requestNote;

        textarea.dataset.savedValue = savedEntry?.note || "";
        textarea.dataset.dirty = changedSinceRequest ? "true" : "";

        if (!changedSinceRequest && getActiveElement() !== textarea) {
          textarea.value = savedEntry?.note || "";
        }

        await onSaved({ textarea, savedEntry, noteId, requestValue, requestNote, changedSinceRequest });
        setStatus(
          textarea,
          getSavedMessage({ textarea, savedEntry, noteId, requestValue, requestNote, changedSinceRequest }),
          changedSinceRequest ? "saving" : "success"
        );
      } catch (error) {
        const handled = await onError({ error, textarea, noteId, requestValue, requestNote });
        if (!handled) {
          setStatus(textarea, getErrorMessage({ error, textarea, noteId, requestValue, requestNote }), "error");
        }
      } finally {
        textarea.dataset.saving = "";

        const needsResave = textarea.dataset.resave === "true"
          || (textarea.dataset.dirty === "true" && normalizeNoteValue(textarea.value) !== (textarea.dataset.savedValue || ""));

        textarea.dataset.resave = "";
        if (needsResave && shouldKeepScheduling(textarea)) {
          schedule(textarea, 0);
        }
      }
    }

    return {
      clear,
      clearAll,
      schedule,
      markDirty,
      commit,
      destroy: clearAll
    };
  }

  globalThis.LodWrapperNotes = {
    normalizeNoteValue,
    createNoteAutosaveController
  };
})();
