# Core Extension Roadmap

Ordered issues for improving LODVault's core functionality and code quality. Firefox-specific work is intentionally excluded.

1. [x] [#15 — Preserve Vault preview state on entry changes](https://github.com/Mohammed-Ashour/lod-vault/issues/15) — completed in [PR #35](https://github.com/Mohammed-Ashour/lod-vault/pull/35)
   - Favorite/Study toggles and deletion now preserve scroll position and expanded meanings.

2. [x] [#8 — Add a “Due today” flashcard deck and due-count badge](https://github.com/Mohammed-Ashour/lod-vault/issues/8)
   - The flashcards page now filters cards whose `dueAt` has passed and shows their count in the stats bar.

3. [#25 — Add a daily review target and resumable flashcard sessions](https://github.com/Mohammed-Ashour/lod-vault/issues/25)
   - Build on the Due-today deck so learners can finish and resume bounded study sessions.

4. [#17 — Deduplicate storage and sync helpers](https://github.com/Mohammed-Ashour/lod-vault/issues/17)
   - Establish `store-core.js` as the single source of truth for normalization, settings, merge timestamps, and sync constants before the copies drift further.

5. [#18 — Split `popup-app.js` into feature modules](https://github.com/Mohammed-Ashour/lod-vault/issues/18)
   - Make the popup safer to change by separating its sync, current-word, saved-list, and import/backup responsibilities.
