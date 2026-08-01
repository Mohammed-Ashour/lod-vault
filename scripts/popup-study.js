// popup-study.js — Study feature module for the popup page.
//
// Renders the Study card: how many cards are due/new, today's progress and
// streak, and a single Start-review entry point into the flashcards page.
// Data comes from the vault entries (state.savedEntries), the flashcard
// review meta (store.getFlashcardMeta / store.getFlashcardStats) and the
// daily target stored under the flashcard settings key.
//
// Cross-module calls (resolved lazily at runtime):
//   ctx.list.openFlashcards() — Start review opens the flashcards page
(() => {
  const FLASHCARD_SETTINGS_KEY = "lodVault.flashcardSettings";

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

    async function getDailyTarget() {
      try {
        const saved = await chromeApi?.storage?.local?.get?.(FLASHCARD_SETTINGS_KEY);
        const target = Number(saved?.[FLASHCARD_SETTINGS_KEY]?.dailyTarget);
        return Number.isFinite(target) && target > 0 ? target : 0;
      } catch {
        return 0;
      }
    }

    function renderStudyCard({ dueCount, newCount, todayCount, streak, dailyTarget }) {
      if (!elements.studySummary || !elements.studyProgress) return;

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

      const parts = [];
      if (dailyTarget > 0) {
        parts.push(`${Math.min(todayCount, dailyTarget)} of ${dailyTarget} today`);
      } else if (todayCount > 0) {
        parts.push(`${todayCount} reviewed today`);
      }
      if (streak > 0) {
        parts.push(`${streak}-day streak`);
      }
      elements.studyProgress.textContent = parts.length
        ? parts.join(" · ")
        : (state.savedEntries?.length
            ? "No reviews yet"
            : "Save words on lod.lu to start studying.");

      if (elements.startDueReview) {
        elements.startDueReview.textContent = hasDue ? "Start due review" : "Open flashcards";
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

      const { dueCount, newCount } = computeDueAndNewCounts(entries, meta);

      let todayCount = 0;
      let streak = 0;
      if (typeof store.getFlashcardStats === "function") {
        try {
          const stats = await store.getFlashcardStats();
          todayCount = Number(stats?.todayCount) || 0;
          streak = Number(stats?.streak) || 0;
        } catch {
          // Keep zeroed stats when review data is unavailable.
        }
      }

      renderStudyCard({
        dueCount,
        newCount,
        todayCount,
        streak,
        dailyTarget: await getDailyTarget()
      });
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
