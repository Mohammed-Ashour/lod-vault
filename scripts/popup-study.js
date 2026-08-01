// popup-study.js — Study feature module for the popup page.
//
// Renders the compact Study banner: due/new counts and a single
// Start-review entry point into the flashcards page. Data comes from the
// vault entries (state.savedEntries) and the flashcard review meta
// (store.getFlashcardMeta). Detailed stats (streak, daily target, session
// progress) live on the flashcards page.
//
// The banner's counts are scoped to the deck the button opens: with due
// cards it deep-links to the Due-today deck (?deck=due); otherwise it
// opens the flashcards page as-is (default deck).
(() => {
  let refreshToken = 0;
  let lastDueCount = 0;

  function createStudyModule(ctx) {
    const { store, chromeApi, state, elements } = ctx;

    function computeDueAndNewCounts(entries, meta) {
      const now = Date.now();
      let dueCount = 0;
      let newCount = 0;

      for (const entry of entries || []) {
        const card = meta?.[entry?.id];
        if (!card || !card.totalReviews) {
          newCount += 1;
          continue;
        }
        const dueTime = Date.parse(card.dueAt || "");
        if (Number.isFinite(dueTime) && dueTime <= now) {
          dueCount += 1;
        }
      }

      return { dueCount, newCount };
    }

    function renderStudyCard({ dueCount, newCount }) {
      if (!elements.studySummary) return;

      const hasDue = dueCount > 0;
      const hasNew = newCount > 0;
      const summary = hasDue && hasNew
        ? `${dueCount} due · ${newCount} new`
        : hasDue
          ? `${dueCount} due`
          : hasNew
            ? `${newCount} new`
            : "Nothing due right now";

      elements.studySummary.textContent = summary;
      elements.studySummary.classList.toggle("is-empty", !hasDue);

      if (elements.startDueReview) {
        elements.startDueReview.textContent = hasDue ? "Start review" : "Study cards";
      }
    }

    async function refreshStudyCard() {
      const token = ++refreshToken;
      const entries = state.savedEntries || [];

      let meta = {};
      if (typeof store.getFlashcardMeta === "function") {
        try {
          meta = (await store.getFlashcardMeta()) || {};
        } catch {
          meta = {};
        }
      }

      // A newer refresh superseded this one while we were awaiting storage:
      // drop the stale result instead of repainting with old counts.
      if (token !== refreshToken) return;

      const { dueCount, newCount } = computeDueAndNewCounts(entries, meta);
      lastDueCount = dueCount;
      renderStudyCard({ dueCount, newCount });
    }

    function startDueReview() {
      const url = chromeApi.runtime.getURL(
        `pages/flashcards.html${lastDueCount > 0 ? "?deck=due" : ""}`
      );
      chromeApi.tabs.create({ url });
    }

    return {
      refreshStudyCard,
      startDueReview
    };
  }

  globalThis.LodVaultPopupStudy = {
    create: createStudyModule
  };
})();
