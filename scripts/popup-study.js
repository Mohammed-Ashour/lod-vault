// popup-study.js — Study feature module for the popup page.
//
// Renders the compact Study row: due/new counts and a single Start-review
// entry point into the flashcards page. Data comes from the vault entries
// (state.savedEntries) and the flashcard review meta
// (store.getFlashcardMeta). Detailed stats (streak, daily target, session
// progress) live on the flashcards page.
//
// Cross-module calls (resolved lazily at runtime):
//   ctx.list.openFlashcards() — Start review opens the flashcards page
(() => {
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
      const entries = state.savedEntries || [];

      let meta = {};
      if (typeof store.getFlashcardMeta === "function") {
        try {
          meta = (await store.getFlashcardMeta()) || {};
        } catch {
          meta = {};
        }
      }

      renderStudyCard(computeDueAndNewCounts(entries, meta));
    }

    function startDueReview() {
      if (typeof ctx.list?.openFlashcards === "function") {
        ctx.list.openFlashcards();
        return;
      }
      chromeApi.tabs.create({ url: chromeApi.runtime.getURL("pages/flashcards.html") });
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
