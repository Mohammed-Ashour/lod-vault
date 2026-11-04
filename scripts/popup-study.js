(() => {
  let refreshToken = 0;
  let hasQueue = false;

  function createStudyModule(ctx) {
    const { store, chromeApi, state, elements } = ctx;

    function renderStudyCard({ dueCount, newCount, reviewedToday, streak }) {
      if (!elements.studySummary) return;

      const hasWork = dueCount > 0 || newCount > 0;
      const parts = [];
      if (dueCount > 0) parts.push(`${dueCount} due`);
      if (newCount > 0) parts.push(`${newCount} new`);
      const summary = hasWork
        ? parts.join(" · ")
        : reviewedToday > 0 ? "All done for today" : "Nothing due right now";

      elements.studySummary.textContent = summary;
      elements.studySummary.classList.toggle("is-empty", !hasWork);

      if (elements.startDueReview) {
        elements.startDueReview.textContent = hasWork ? "Start review" : "Study cards";
      }

      if (elements.studyActivity) {
        const activity = [];
        if (streak > 0) activity.push(`${streak}-day streak`);
        if (reviewedToday > 0) activity.push(`${reviewedToday} reviewed today`);
        elements.studyActivity.textContent = activity.join(" · ");
        elements.studyActivity.classList.toggle("is-hidden", !activity.length);
      }
    }

    async function refreshStudyCard() {
      const token = ++refreshToken;
      const entries = state.savedEntries || [];

      let meta = {};
      let dailyTarget = 0;
      try {
        [meta, dailyTarget] = await Promise.all([
          store.getFlashcardMeta(),
          store.getFlashcardDailyTarget()
        ]);
      } catch {
        meta = {};
      }

      // A newer refresh superseded this one while we were awaiting storage:
      // drop the stale result instead of repainting with old counts.
      if (token !== refreshToken) return;

      const today = store.buildTodayQueue(entries, meta || {}, { dailyTarget });
      hasQueue = today.queue.length > 0;
      renderStudyCard(today);
    }

    function startDueReview() {
      const url = chromeApi.runtime.getURL(
        `pages/flashcards.html${hasQueue ? "?deck=today" : ""}`
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
