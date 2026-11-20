# LODVault architecture

## Purpose

LODVault is a local-first browser extension for saving and reviewing Luxembourgish vocabulary from LOD. It includes a popup, a searchable Vault page, Flashcards, an article banner and selection-based LOD Lens lookup.

## Scope and assumptions

Verified on 2026-10-17 against `manifest.json`, `package.json`, the page entry points and their script lists. This is a plain HTML/CSS/JavaScript extension, not a web application with a server. There is no `src/` tree or Python runtime.

This change consolidates Popup, Vault and Flashcards layout. The article banner and LOD Lens are not redesigned.

## System overview

The manifest loads the popup and background service worker. Each extension page loads storage/presentation helpers before its page controller. Content scripts attach the article banner to lod.lu. Background code coordinates extension messaging and optional Lens injection.

Local storage remains authoritative. Browser sync is a compact replica, and JSON backups are portable copies.

## Architecture diagram

```mermaid
flowchart TD
  Manifest[manifest.json] --> Popup[pages/popup.html]
  Manifest --> Background[scripts/background-bundle.js]
  Manifest --> Article[scripts/content.js + page-banner.js]
  Popup --> PopupApp[scripts/popup-app.js]
  PopupApp --> Modules[Current / List / Lookup / Study / Sync / Backup]
  Modules --> Store[scripts/shared.js + store-core.js]
  Modules --> Lookup[scripts/lens-lookup.js]
  Lookup --> LOD[LOD dictionary API]
  Store --> Local[chrome.storage.local]
  Store --> Sync[Optional browser sync]
  Popup --> Vault[pages/preview.html + preview.js]
  Popup --> Flashcards[pages/flashcards.html + flashcards.js]
  Vault --> Presenter[scripts/entry-presenter.js]
  Flashcards --> Store
  Background --> Lens[Selection lookup runtime]
```

## Runtime entry points

- `manifest.json`: `pages/popup.html`, `scripts/background-bundle.js`, article content scripts and the `open-lod-lens` command.
- `pages/preview.html`: `scripts/preview.js`, the live Vault and its generated iframe document.
- `pages/flashcards.html`: `scripts/flashcards.js`, review sessions.
- `scripts/popup.js`: initializes the popup app and handles section navigation.
- `package.json`: Node tests, background build and release/package lint commands. `scripts/build_release_zip.sh` emits Chrome and Firefox variants.

## Architectural layers

1. Page HTML and CSS own layout, scroll containers and theme tokens.
2. Page controllers own UI events and rendering. Popup responsibilities remain split across `scripts/popup-*.js`.
3. `scripts/shared.js`, `scripts/store-core.js`, `scripts/note-autosave.js` and `scripts/entry-presenter.js` provide storage contracts, autosave and presentation helpers.
4. `scripts/lens-lookup.js` provides dictionary lookup and canonical entry retrieval.
5. Background and sync modules coordinate mutations, extension messaging and replication. Store mutations fall back locally only when transport reports no receiver. A closed port or worker error is propagated without replay because the write may already have committed. Review save failures block further grading until reload. Store mutations are checked against the sender: content scripts and the injected Lens can only save words, and everything else needs an extension page.

Dependencies point from page controllers toward these helpers. Layout changes must not change persistence semantics.

## External integrations

- LOD dictionary search and article content, plus pronunciation audio from lod.lu.
- Browser local/sync storage and extension tab, scripting, context-menu and alarm APIs.
- Browser history only through its optional permission.
- Chrome/Firefox packaging via the existing release script and web-ext lint.

## Core data flow, current

1. My vault filters saved entries locally. It sends no dictionary request.
2. Search LOD delegates to the lookup module. New dictionary saves fetch a canonical entry before mutation. Stale responses cannot replace a newer query.
3. Mutations update local entries. Storage refreshes update membership and presentation without replacing live lookup editors.
4. The Vault renders generated export HTML inside an iframe, then adds live edit controls. Preview refreshes preserve its edit and scroll state.
5. Flashcards reads entries and review metadata and persists review progress through the existing store. `buildTodayQueue` in `scripts/store-core.js` is the single definition of what is due today, shared by the popup, Flashcards and the toolbar badge. Its "today" numbers count cards, not reviews. Review metadata is keyed by card id: a word's core card uses the entry id, and later skill cards use `<entryId>#<skill>`; `baseCardId()` maps either to the word, and sync and deletion go by that word.
6. Review progress syncs in its own `lodVault.p.*` keys, outside the manifest and format version. Each key is a hash bucket, so one review rewrites one item. Words have priority over the quota: progress takes the space left after an 8 KB margin, up to 24 KB, and the most recently reviewed words are kept. Only the latest review per word travels, so older review history stays on the device that recorded it. The review log stays complete in JSON backups. Builds before 2.4.0 count these keys against the quota but can't remove them, so a vault with more than about 76 KB of synced words can show sync as paused on an older build until it updates. From 2.5 each record also carries the FSRS state (`s` stability×100, `f` difficulty×10, `t` state, `x` lapses, `u` suspended) and the 1..4 grade as a fourth element of the review tuple. Optional `lm` and `rm` preserve milliseconds for the latest review clock and event; `rt` carries the optional response duration. Legacy second-only echoes are conservatively deduplicated against matching precise events. Schedule merges use `sr` independently of review history and pause, with deterministic value ties. Optional fields `a` and `b` carry the scheduling timestamp in milliseconds and learning step; the fifth review tuple element carries kind, so practice remains excluded from daily allowances after sync; older builds ignore them.
7. Scheduling lives in `scripts/srs.js` (`globalThis.LodVaultSrs`), a pure FSRS-5 module loaded before `store-core.js` in the extension pages, the background bundle and tests (content scripts don't load it and don't schedule). `recordFlashcardReview(cardId, grade 1..4, direction, {kind, ms})` checks word membership inside the serialized mutation and returns `{ok:false, reason:"missing-entry"}` without writing if deleted. Successful calls return `{previous, record}`. If present, `LodVaultActivity.captureReview({date, isNew, meta}, persist)` receives pre-review metadata; its extra storage keys and the new metadata are committed by one local storage write. Without that hook only metadata is written. It writes the FSRS state (`srs: 1, s, d, st, step, lapses`) next to the older fields (`rating` 1..3, `interval`, `dueAt`, counts), which 2.4.0 builds still read from synced progress. Cards from older builds migrate when next reviewed. `undoFlashcardReview` restores the previous record while the undone review is still the latest. Flashcard settings (`lodVault.flashcardSettings`) stay on the device.
8. `scripts/flashcards.js` owns session order, positional learning retries and the undo stack. Every deck ends with a summary. `lodVault.flashcardSession` stores card ids, position, results, retry counts and the local day; Today resumes automatically only on that day. Entries are re-resolved after storage changes. Undo restores the store record only if its review is still latest, then restores session position.
9. `setFlashcardSuspended(cardId, boolean)` preserves scheduling while excluding a card from Today. Pause changes have their own `pausedAt` timestamp. Sync retains legacy seconds in `w` and exact milliseconds in optional `wm`; the later decision wins independently of scheduling, with suspension winning exact timestamp ties. Undo preserves this independent state. This API does not itself supply a Vault pause control.

10. Saved words (Favorites or Study) get a local lexicon record in `lodVault.lx.<ID>` (`scripts/lexicon-store.js`), parsed by `LodVaultLensLookup.parseLexicon` from the same `/api/lb/entry/<ID>` response the flattened entry comes from. It keeps what the flattened entry drops: gender, every plural with its n-rule form, auxiliary and participles, conjugation, comparison, and up to 12 senses with stable `meaningID`s, per-language `[translation, clarifier]` pairs and up to three examples whose inflected headwords are stored as character spans. It is local-only and never synced. The background keeps the last LOD entry responses from its Lens proxy for ten minutes, so the lookup that leads to a save also fills the lexicon. Words saved earlier, records older than 90 days and pages that ask for a session's words (`lodvault:lexicon-hydrate`) go through a queue with at most two requests at once and exponential backoff on 429, 5xx and network errors; a missing article is not asked for again for 30 days (`lodVault.lxMiss`). `lodVault.lxIndex` holds `[fetchedAt, bytes]` per record so reconciliation and the 12 MB soft budget don't read every record; over budget, favourites-only records give way to words in Study. Deleting a word removes its record. JSON backups include the records only when asked; restore keeps the newer copy. Optional modules register backup sections through `registerBackupSection`; the popup collects them and excludes lexicon unless selected. Lexicon uses `sections.lexicon`; imports also accept the legacy top-level `lexicon` key and return `lexiconCount`. Import handlers receive the pending vault's saved IDs so lexicon restoration precedes entry persistence and hydration. Other optional sections, including activity and tags/decks when loaded, retain their own handlers.

11. Daily study totals live in local `lodVault.activity` (about a year, `{day: [reviews, new, flags]}`) and sync under `lodVault.a` (last 60 days plus the streak state just before them, about 1 KB). `scripts/activity.js` owns them. The store calls the narrow `captureReview` hook inside its serialized local review mutation. The hook serializes against activity writes using its queue and an origin-scoped Web Lock across extension contexts, and adds the activity record and a local-only random device identity to the same storage set as review metadata. Per-device daily counters merge by maximum, then sum across devices. A one-time retained-log migration and legacy totals remain conservative floors; lost historical work cannot be recovered. Background scans only seed legacy records and mark queue clearance after capture begins. Activity counts performed attempts, so scheduling undo does not erase work; deleted or re-added cards do not erase past activity. New counts are introductions per device, not globally deduplicated words. The streak, freezes and rest days are computed from these totals, so every device shows the same streak. `lodVault.a` counts against the sync budget before progress and appears in the capacity stats. JSON backups carry it in an optional `sections.activity` block; modules register backup sections through `registerBackupSection` in store-core. Builds before 2.4.0 count these keys against the quota but can't remove them, so a vault with more than about 76 KB of synced words can show sync as paused on an older build until it updates.

## Module ownership boundaries

- `styles/blue-night.css`: shared tokens, buttons, menus and companion-page header behavior. Generated export tokens in `scripts/entry-presenter.js` must match theme changes.
- `styles/popup.css` and `pages/popup.html`: bounded popup shell, fixed search controls, current-word disclosure inside the Words scroller and a collapsing status/Undo footer below it.
- `scripts/popup-lookup.js`: remote query/language state, stale-request protection, hydration, membership patching and note-recovery behavior. It retains result DOM across an unchanged source round trip.
- `scripts/popup-list.js`: local filtering and saved rows. Retained rows reuse live note sections during refresh.
- `scripts/popup-current.js`: active article and current-note behavior.
- `scripts/popup-app.js`: module wiring, storage/tab events, autosave, feedback and delete/Undo.
- `scripts/preview.js` and `styles/preview.css`: live Vault editing and remaining-height iframe layout.
- `scripts/flashcards.js` and `styles/flashcards.css`: review behavior and responsive card/session controls.
- `scripts/lexicon-store.js`: lexicon records, their index and the background hydration queue. `parseLexicon` in `scripts/lens-lookup.js` is separate from the flattened-entry parser and must stay pure.
- `scripts/answer-grader.js`: the shared typed-answer grader (`LodVaultAnswerGrader`) for flashcard exercises. Pure comparison (NFC, apostrophes, end punctuation, accent tolerance graded Hard, listed alternatives, n-rule forms, noun capitals, one-edit typo prompt for words of six or more letters, character diff) plus the ë/é/ä buttons and diff rendering, styled by `styles/answer-grader.css`. `docs/demo/answer-grader.html` is a development demo (not shipped).
- `scripts/card-registry.js`: `LodVaultCards`, the card registry. A word's core card keeps the entry id; skill cards are `entryId#skill` (`g` gender, `pl` plural, `pp` perfect, `cz` cloze, `sd` which meaning, `rev` produce), each with its own meta record. A skill applies when the word's lexicon has the data it needs, unlocks once the core card's stability (FSRS `s`, or the legacy interval) reaches 4 days, and can be switched off in `lodVault.cardSkills`. `buildSkillQueue` gives at most one card per word per day (siblings are buried once any card of the word is studied or queued) and caps new skill cards per day; `mergeTodayQueue` puts them after the core queue's due and new words respectively. It also holds the leech rule (6 lapses), same-part-of-speech distractors, sense focus and the sync priority (core cards before skill cards).
- `scripts/flashcards-exercises.js` and `styles/flashcards-exercises.css`: `LodVaultExercises`, the skill-card exercises (gender via deen/déi/dat, typed plural, hunn/sinn + participle, cloze over the example's headword spans with example audio after, which-meaning from the word's own senses, produce with article) and the lexicon meaning card and ⚑ leech panel. They render into a container and report a 1–4 grade through `onGrade`; they never write storage. `docs/demo/exercises.html` is a development demo (not shipped).
- `scripts/activity.js`: daily activity totals, streak rules and their sync value.
- `scripts/background-impl.js`: toolbar due badge, refreshed on entry and review changes and by a `chrome.alarms` alarm at local midnight.

## Architecture change protocol

Keep storage schemas, permissions, dictionary privacy and review scheduling unchanged during UI work. Preserve note flush/recovery and canonical-entry hydration tests. Avoid moving remote lookup lifecycle code into the export presenter merely to share markup.

Run `npm test`, `npm run test:ui`, `npm run test:popup` and `npm run lint` for changes to these UI contracts. The browser check uses an isolated profile and fixtures, not real vault data.

## Future clarifications

Phase 2 supplies standalone parser, registry, grader and exercise components, not an integrated Flashcards session. Remaining work includes session loading and lexicon prefetch, skill settings persistence and per-skill grades/queue wiring, live sibling burial, retries/resume/undo, focus and suspend mutations, `fs` preservation and sync, core meaning/MC rendering, and core-before-skill sync priority. Phase 1 and Phase 3 remediation require separate combined integration verification. The Phase 2 recorder is `scripts/record-phase2-flow.mjs`, distinct from Phase 1 capture tooling.

Leech panels contain focus while mounted. Hosts must call the returned panel's `destroy()` on teardown; removal also releases the focus listener. Close restores the opener, while Save and Pause report callbacks without closing. Exercise controllers must be destroyed when replaced; destroyed controllers and retained feedback actions cannot report grades.

The actual Chrome action window is checked through a debugging pipe in an isolated profile, separately from page emulation. Its host can clamp height and add gutter space. Firefox rendering, screen-reader output and increased zoom still require manual verification. Page geometry checks alone cannot validate native popup auto-sizing.
