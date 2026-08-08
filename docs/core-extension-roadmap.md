# Core Extension Roadmap

Ordered issues for improving LODVault's core functionality and code quality. Firefox-specific work is intentionally excluded.

1. [x] [#15 — Preserve Vault preview state on entry changes](https://github.com/Mohammed-Ashour/lod-vault/issues/15) — completed in [PR #35](https://github.com/Mohammed-Ashour/lod-vault/pull/35)
   - Favorite/Study toggles and deletion now preserve scroll position and expanded meanings.

2. [x] [#8 — Add a “Due today” flashcard deck and due-count badge](https://github.com/Mohammed-Ashour/lod-vault/issues/8)
   - The flashcards page now filters cards whose `dueAt` has passed and shows their count in the stats bar.

3. [x] [#25 — Add a daily review target and resumable flashcard sessions](https://github.com/Mohammed-Ashour/lod-vault/issues/25)
   - Completed in [PR #37](https://github.com/Mohammed-Ashour/lod-vault/pull/37): bounded daily review targets and session resume.

4. [x] [#17 — Deduplicate storage and sync helpers](https://github.com/Mohammed-Ashour/lod-vault/issues/17)
   - Completed in [PR #40](https://github.com/Mohammed-Ashour/lod-vault/pull/40): `store-core.js` is now the single source of truth for normalization, settings, merge timestamps, and sync constants.

5. [x] [#18 — Split `popup-app.js` into feature modules](https://github.com/Mohammed-Ashour/lod-vault/issues/18)
   - In progress on `refactor/split-popup-app-modules`. `popup-app.js` is now a thin composition root; the popup's sync, current-word, saved-list, and import/backup responsibilities live in `popup-sync.js`, `popup-current.js`, `popup-list.js`, and `popup-backup.js` respectively, sharing state through a `ctx` object.
