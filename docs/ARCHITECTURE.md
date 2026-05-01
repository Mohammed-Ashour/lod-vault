# LODVault Architecture

This document describes the current architecture of the extension after the store split, page-module split, popup split, and sync-coordination refactor.

---

## 1. High-level shape

LODVault is a Chrome extension with four main runtime parts:

1. **Content runtime**
   - Runs on `lod.lu/artikel/*`
   - Reads the current LOD article
   - Renders the inline page banner
   - Handles auto-record, page-local note editing, and popup messaging

2. **Popup runtime**
   - The main control surface for saved words
   - Shows the current word, recent saved words, search, notes, auto mode, and saved-language selection

3. **Background runtime**
   - Serializes store mutations
   - Initializes sync
   - Bridges local storage changes to sync storage and sync changes back to local storage

4. **Shared runtime modules**
   - Saved-word storage rules
   - Note autosave behaviour
   - Saved-word presentation helpers
   - Sync serialization and coordination

The key design rule is still:

> `chrome.storage.local` is authoritative. `chrome.storage.sync` is a compact replication layer.

---

## 2. Runtime module map

## 2.1 Store and presentation modules

### `scripts/store-core.js`
Owns the local vocabulary-vault rules:
- entry normalization
- settings normalization
- local storage read/write helpers
- legacy storage migration
- list mutation rules
- auto-record rules
- note persistence
- JSON import/export
- mutation proxying to background

This is the deepest store module in the codebase. Most callers should depend on this seam through `LodWrapperStore` rather than reimplementing store rules.

### `scripts/note-autosave.js`
Owns note autosave behaviour:
- timer scheduling
- dirty/saving/resave state
- save callbacks
- status callbacks

It is intentionally generic so popup and page banner can share the same note Interface.

### `scripts/entry-presenter.js`
Owns saved-word presentation helpers:
- escaping
- date formatting
- search-text generation
- translation/meaning helpers
- export entry markup
- export document generation
- file download helper

Popup, preview, flashcards, and export all use this module instead of each building their own presentation rules.

### `scripts/shared.js`
Thin compatibility facade that composes:
- `LodWrapperStoreCore`
- `LodWrapperNotes`
- `LodWrapperEntryPresenter`

This keeps the runtime no-build style intact while narrowing the responsibilities of the underlying modules.

---

## 2.2 Content runtime modules

### `scripts/lod-article.js`
Owns LOD article-reading rules:
- heading extraction
- URL/lemma extraction
- translation extraction
- stale-page protection during SPA navigation
- current-entry construction
- article info text

This module is the seam for “what word is on this LOD page right now?”

### `scripts/page-banner.js`
Owns the inline page banner:
- banner creation and placement
- banner note state
- status text
- button labels
- banner rendering and update suppression
- invalidated-extension UI

It depends on the article reader and store but does not own page refresh orchestration.

### `scripts/content.js`
Thin page-runtime adapter that wires together:
- article reading
- page banner rendering
- auto mode recording
- page refresh scheduling
- message handling with popup/background
- DOM and location observers

This file should stay focused on orchestration, not on extraction rules or banner markup details.

---

## 2.3 Popup runtime modules

### `scripts/popup-app.js`
Owns popup state and popup flows:
- current-word card
- saved-word list
- search
- note autosave wiring
- auto mode UI
- saved-language selection UI
- tab/runtime messaging
- export/import actions

### `scripts/popup.js`
Thin entry adapter:
- creates the popup app
- starts it on `DOMContentLoaded`
- destroys it on unload

This keeps the popup seam narrower than the previous single-file design.

---

## 2.4 Background and sync modules

### `scripts/sync.js`
Owns compact sync behaviour:
- compact/expand entry format
- translation filtering for sync
- shard building
- merge rules
- manifest/settings serialization
- migration handling
- quota safety
- partial-read tolerance
- `SyncAdapter` fast paths

### `scripts/sync-coordinator.js`
Owns replication coordination policy:
- local change classification
- settings-only vs entry-only vs full push planning
- debounce windows
- suppression windows
- init scheduling
- push/pull orchestration

### `scripts/background.js`
Thin service-worker adapter:
- loads modules
- keeps the mutation queue for store writes
- reloads LOD tabs on install/update
- forwards storage events into the sync coordinator
- exposes store mutations to other runtimes through messaging

---

## 2.5 Secondary UI modules

### `scripts/preview.js`
Preview page adapter built on the shared presentation module.

Responsibilities:
- render live preview HTML from local data
- apply language/search filters in the preview iframe
- attach remove buttons to preview entries

### `scripts/flashcards.js`
Flashcard page adapter built on the shared presentation module.

Responsibilities:
- deck filtering
- shuffle/reveal/navigation
- storage-change refresh

---

## 3. Load order and composition

Because the extension keeps a no-build architecture, runtime composition happens by script load order.

### Popup page
Load order is:
1. `store-core.js`
2. `note-autosave.js`
3. `entry-presenter.js`
4. `shared.js`
5. `popup-app.js`
6. `popup.js`

### Preview / flashcards pages
Load order is:
1. `store-core.js`
2. `entry-presenter.js`
3. `shared.js`
4. page-specific adapter

### Content script
Load order is:
1. `store-core.js`
2. `note-autosave.js`
3. `entry-presenter.js`
4. `shared.js`
5. `lod-article.js`
6. `page-banner.js`
7. `content.js`

### Background service worker
Load order is:
1. `store-core.js`
2. `shared.js`
3. `sync.js`
4. `sync-coordinator.js`
5. `background.js`

The important consequence is that the thin adapter files assume the deeper modules are already present on `globalThis`.

---

## 4. Data model

## 4.1 Local entry shape

Entries are stored in local storage under:
- `lodVault.entries`

Each entry is normalized in `store-core.js` and looks conceptually like:

```js
{
  id,
  word,
  url,
  pos,
  inflection,
  example,
  note,
  translations,
  favorite,
  study,
  history,
  visitCount,
  lastVisitedAt,
  createdAt,
  updatedAt
}
```

An entry is kept only if at least one of these is true:
- `favorite`
- `study`
- `history`

## 4.2 Settings shape

Stored in local storage under:
- `lodVault.settings`

Current settings:

```js
{
  autoMode: false,
  syncLanguages: ["en", "fr", "de"]
}
```

`store-core.js` validates and normalizes these settings.

---

## 5. Storage architecture

## 5.1 Local storage

`chrome.storage.local` is the source of truth.

Why:
- no small quota pressure
- full translations are preserved locally
- UI state stays simple
- sync failures never block normal use

## 5.2 Sync storage

`chrome.storage.sync` stores a compact replicated copy.

It contains:
- `lodVault.m` → manifest
- `lodVault.s` → settings snapshot for sync
- `lodVault.e.N` → compact entry shards

Compact sync format reduces field sizes and only includes translations allowed by `syncLanguages`.

---

## 6. Sync architecture

## 6.1 Sync format

`sync.js` converts local entries into compact sync entries.

Examples:
- `id -> i`
- `word -> w`
- `url -> u`
- `translations -> t`
- flags packed into `a`

Translation key mapping:
- `en -> e`
- `fr -> f`
- `de -> d`
- `pt -> p`
- `nl -> l`

## 6.2 Sharding

Entries are sorted by `id` and grouped into shard arrays.

Target:
- soft limit: `7000` bytes per shard
- hard sync item safety: `8192` bytes

## 6.3 SyncAdapter API

The deep sync seam in `sync.js` is:
- `init()`
- `pushAll()`
- `pullAll()`
- `pushEntry(id)`
- `pushSettings()`
- `destroy()`

## 6.4 Sync coordination seam

The coordination seam in `sync-coordinator.js` decides when to call the adapter.

Important behaviours:
- local entry-only changes prefer `pushEntry(id)`
- auto-mode-only changes prefer `pushSettings()`
- mixed or risky changes fall back to `pushAll()`
- sync-triggered pulls suppress redundant local-triggered pushes
- local-triggered pushes suppress redundant sync-triggered pulls

This split keeps serialization rules in one module and orchestration policy in another.

---

## 7. End-to-end flows

## 7.1 Save a word from the page banner

1. `lod-article.js` extracts the current entry
2. `page-banner.js` renders the banner
3. User toggles Favorite or Study
4. `store-core.js` mutates local storage
5. `background.js` receives the storage change
6. `sync-coordinator.js` classifies the change
7. `sync.js` pushes the compact sync update

## 7.2 Auto-record a visited word

1. `content.js` refreshes the page state
2. `store-core.js.getAutoMode()` loads settings
3. `content.js` calls `recordAutoVisit()` when needed
4. The updated local entry triggers sync through the background runtime

## 7.3 Edit a note

1. Popup or page banner delegates to `note-autosave.js`
2. The autosave module debounces and commits the change
3. `store-core.js.saveNote()` writes the normalized note
4. UI adapters rerender using the updated entry
5. Background sync bridges the local mutation if sync is active

## 7.4 Pull data from another device

1. Sync storage changes
2. Background forwards the change to `sync-coordinator.js`
3. The coordinator schedules `pullAll({ repush: true })`
4. `sync.js` expands shards and merges remote entries into local storage
5. UIs reread local storage and reflect the merged state

## 7.5 Render preview/export/flashcards

1. UI adapter loads entries from `LodWrapperStore`
2. Presentation helpers from `entry-presenter.js` generate the shared meaning/export markup
3. The page-specific adapter adds its own interaction layer

---

## 8. Testing architecture

Tests live under `tests/`.

### Key test areas

- `tests/shared.test.js`
  - store-core behaviour through the `LodWrapperStore` facade
  - normalization
  - import/export
  - settings behaviour
  - note autosave helpers
  - export/presentation helpers

- `tests/popup.test.js`
  - popup app rendering
  - search behaviour
  - saved-language UI behaviour

- `tests/background.test.js`
  - mutation queue behaviour
  - install/startup behaviour
  - local/sync change routing
  - fast-path selection (`pushEntry`, `pushSettings`)

- `tests/content.test.js`
  - article reading
  - banner rendering
  - popup messaging
  - saved-entry enrichment

- `tests/sync.test.js`
  - compact/expand roundtrips
  - merge rules
  - sharding
  - partial shard reads
  - migration
  - quota fallback
  - shard-level sync fast path

### Loader strategy

`tests/helpers/loaders.js` constructs mocked runtimes and now mirrors the new module composition by loading the split script set in the same order as production.

That keeps the test seam close to the real runtime seam.

---

## 9. Current architectural principles

The codebase currently follows these principles:

1. **Local-first**
   - local storage is authoritative
   - sync is best-effort replication

2. **Conservative correctness over cleverness**
   - fast paths are used only when clearly safe
   - otherwise the code falls back to full rebuild/merge

3. **Centralized vocabulary-vault rules**
   - store-core owns saved-word and settings rules

4. **Shared note and presentation seams**
   - popup and page banner share note autosave behaviour
   - popup, preview, flashcards, and export share saved-word presentation helpers

5. **Thin runtime adapters**
   - `content.js`, `popup.js`, and `background.js` are orchestration adapters over deeper modules

6. **Sync isolation**
   - popup/content do not manage sync storage directly
   - background + sync modules own replication

7. **Graceful degradation**
   - quota failures, partial sync data, and old formats do not break core local usage

---

## 10. Remaining likely extension points

Likely future extension points:
- sync status indicator in popup
- user-visible sync diagnostics
- more explicit sync/debug tooling
- more extracted popup submodules if popup flows grow further
- preview-specific document interaction module if preview gains more editing features
- more aggressive shard rebalancing only if sync scale demands it

For now, the architecture is optimized for:
- reliability
- predictable behaviour
- small safe sync fast paths
- shared presentation and note behaviour
- maintainable testing
- better locality than the original single-file runtime modules
