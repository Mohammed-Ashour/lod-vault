# LODVault Architecture

This document describes the current architecture of the extension after the sync work and shard-level sync optimization.

---

## 1. High-level shape

LODVault is a Chrome extension with four main runtime parts:

1. **Content script**
   - Runs on `lod.lu/artikel/*`
   - Extracts the current word from the page
   - Shows the inline save banner on LOD pages

2. **Popup UI**
   - The main control surface for saved words
   - Lets the user view, search, edit notes, toggle auto mode, and choose sync languages

3. **Background service worker**
   - Serializes store mutations
   - Initializes sync
   - Bridges local storage changes to sync storage and sync changes back to local storage

4. **Shared store layer**
   - Central storage API used by popup/content/background
   - Owns local data normalization, import/export, and mutation logic

The important design rule is:

> `chrome.storage.local` is authoritative. `chrome.storage.sync` is a compact replication layer.

---

## 2. File responsibilities

### Core runtime files

- `scripts/shared.js`
  - Canonical store API
  - Entry normalization
  - Settings normalization
  - Local storage read/write helpers
  - Import/export helpers
  - Note autosave controller

- `scripts/content.js`
  - Parses the current LOD article page
  - Builds the page banner UI
  - Talks to popup/background through messaging
  - Uses `LodWrapperStore` for mutations

- `scripts/popup.js`
  - Popup state management and rendering
  - Current-word card
  - Saved list rendering
  - Search/filtering
  - Sync language selector UI
  - Auto mode UI

- `scripts/background.js`
  - Service worker entrypoint
  - Loads `shared.js` and `sync.js`
  - Queues store mutations so they run one at a time
  - Debounces sync writes
  - Routes local changes to `pushEntry`, `pushSettings`, or `pushAll`
  - Routes sync changes to `pullAll`

- `scripts/sync.js`
  - Compact sync serialization/deserialization
  - Sharding logic
  - Merge logic
  - Quota safety checks
  - Partial-read tolerance
  - Legacy sync format migration
  - Shard-level fast-path updates for single-entry changes

### UI files

- `pages/popup.html`
- `styles/popup.css`

These define the popup structure and styling. The sync languages row was added without changing the overall visual system.

### Other UI/runtime

- `pages/flashcards.html` / `scripts/flashcards.js`
- `pages/preview.html` / `scripts/preview.js`

These are secondary UIs built on top of the same local store.

---

## 3. Data model

### Local entry shape

Entries are stored in local storage under:
- `lodVault.entries`

Each entry is normalized in `shared.js` and looks conceptually like:

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

### Settings shape

Stored in local storage under:
- `lodVault.settings`

Current settings:

```js
{
  autoMode: false,
  syncLanguages: ["en", "fr", "de"]
}
```

`shared.js` is responsible for validating and normalizing these settings.

---

## 4. Storage architecture

### Local storage

`chrome.storage.local` is the source of truth.

Why:
- no small quota pressure
- full translations are preserved
- simpler UI/state behavior
- sync failures never block normal use

### Sync storage

`chrome.storage.sync` stores a compact replicated copy.

It contains:
- `lodVault.m` → manifest
- `lodVault.s` → settings snapshot for sync
- `lodVault.e.N` → compact entry shards

Compact sync format reduces field sizes and only includes translations allowed by `syncLanguages`.

---

## 5. Sync architecture

## 5.1 Sync format

`scripts/sync.js` converts local entries into compact sync entries.

Examples:
- `id -> i`
- `word -> w`
- `url -> u`
- `translations -> t`
- flags packed into `a`

Translations are compacted with short keys:
- `en -> e`
- `fr -> f`
- `de -> d`
- `pt -> p`
- `nl -> l`

## 5.2 Sharding

Entries are sorted by `id` and grouped into shard arrays.

Target:
- soft limit: `7000` bytes per shard
- hard sync item limit safety: `8192` bytes

This keeps shards under Chrome sync item size limits.

## 5.3 SyncAdapter API

Current API in `scripts/sync.js`:

- `init()`
- `pushAll()`
- `pullAll()`
- `pushEntry(id)`
- `pushSettings()`
- `destroy()`

### `pushAll()`
Rebuilds all compact shards from local data and writes them to sync.

Used when:
- first push
- migration fallback
- syncLanguages changed
- fast-path update is not safe

### `pullAll()`
Reads sync shards, expands them, merges them into local entries, and optionally re-pushes.

Important behavior:
- local is never blindly replaced
- last-write-wins per entry using timestamps
- translations are merged so local-only languages are preserved
- partial shard reads do not delete local data

### `pushEntry(id)`
Shard-level fast path.

Used when a single local entry changed and sync layout is healthy.

Fast path rules:
- only for an entry that already exists in sync
- updates only the shard that contains that entry
- updates manifest metadata too
- falls back to `pushAll()` if unsafe

Fallback cases include:
- entry not found in sync
- sync layout is partial/inconsistent
- migration is needed
- syncLanguages changed
- updated shard becomes too large
- deletion would create an empty middle shard

### `pushSettings()`
Metadata fast path.

Used when:
- only `autoMode` changed
- `syncLanguages` did not change

It updates only:
- `lodVault.m`
- `lodVault.s`

If `syncLanguages` changed, it falls back to `pushAll()` because all compact entries depend on the language filter.

---

## 6. Background sync orchestration

`background.js` watches storage changes and decides which sync operation to run.

### Local → Sync

When local storage changes:
- if one entry changed: `pushEntry(id)`
- if only `autoMode` changed: `pushSettings()`
- otherwise: `pushAll()`

These writes are debounced to reduce write pressure.

### Sync → Local

When sync storage changes:
- background calls `pullAll({ repush: true })`
- local merges are applied
- migrated/merged data may be re-pushed after a delay

### Loop suppression

Background keeps short suppression windows so that:
- a local-triggered sync write does not immediately trigger a redundant pull
- a sync-triggered local merge does not immediately trigger a redundant push

This prevents ping-pong loops.

---

## 7. Phase 4 shard-level sync design

The new optimization is intentionally conservative.

### What it optimizes

Frequent small mutations like:
- note edits
- favorite/study toggles
- history updates

### What it does not try to over-optimize

It does **not** attempt complicated shard rebalancing.

If a single-entry update is risky, the code chooses correctness and falls back to `pushAll()`.

This keeps the system easier to reason about while still reducing sync churn for common edits.

---

## 8. Migration and robustness

`scripts/sync.js` now handles:

### Partial shard reads
If manifest expects shards that are missing or malformed:
- available shards are still merged
- warnings are logged
- local data is preserved
- automatic re-push is skipped while the sync read is incomplete

### Legacy sync format migration
If old sync data is detected:
- old entries are coerced into the current compact format
- data is merged locally
- a new v3 payload is written back to sync

### Quota handling
Before a sync write:
- per-item sizes are estimated
- total payload size is estimated

If limits would be exceeded:
- sync write is skipped gracefully
- local storage remains fully usable

---

## 9. UI architecture

### Popup
The popup is a lightweight stateful renderer driven by `scripts/popup.js`.

State includes:
- current tab / current word
- saved entries list
- search query
- auto mode
- sync languages

The popup uses the shared store API directly and does not talk to sync storage.

That is deliberate:
- popup logic stays simple
- sync logic stays isolated in background + `sync.js`

### Content script
The content script focuses on page extraction and page-local UI.

It does not own storage rules.

Instead it delegates mutations to `shared.js`, which keeps behavior consistent between popup and in-page UI.

---

## 10. Testing architecture

Tests live under `tests/`.

### Key test areas

- `tests/shared.test.js`
  - local store behavior
  - normalization
  - import/export
  - settings behavior

- `tests/popup.test.js`
  - popup rendering
  - search behavior
  - sync language UI behavior

- `tests/background.test.js`
  - mutation queue behavior
  - install/startup behavior
  - local/sync change routing
  - fast-path selection (`pushEntry`, `pushSettings`)

- `tests/sync.test.js`
  - compact/expand roundtrips
  - merge rules
  - sharding
  - partial shard reads
  - migration
  - quota fallback
  - shard-level sync fast path
  - stress tests

### Loader strategy

`tests/helpers/loaders.js` builds a mocked extension environment with:
- fake `chrome.storage.local`
- fake `chrome.storage.sync`
- fake runtime/tabs events
- JS execution in VM contexts

This makes the architecture testable without a browser.

---

## 11. Current architectural principles

The codebase currently follows these principles:

1. **Local-first**
   - local storage is authoritative
   - sync is best-effort replication

2. **Conservative correctness over cleverness**
   - fast paths are used only when clearly safe
   - otherwise fallback to full rebuild/merge

3. **Centralized normalization**
   - `shared.js` owns shape validation for entries and settings

4. **Sync isolation**
   - popup/content do not manage sync storage directly
   - background + `sync.js` own sync behavior

5. **Graceful degradation**
   - quota failures, partial sync data, and old formats should not break core usage

---

## 12. Current end-to-end flow

### Save a word
1. Content script extracts the current word
2. User toggles favorite/study
3. `shared.js` updates local storage
4. Background sees the local change
5. Background chooses `pushEntry(id)` or `pushAll()`
6. Sync storage updates

### Pull from another device
1. Sync storage changes
2. Background sees the sync change
3. `pullAll()` expands + merges remote data into local
4. If needed, normalized data is re-pushed
5. Popup/content reflect the merged local state

### Change auto mode only
1. Popup updates local settings
2. Background sees a settings-only change
3. Background calls `pushSettings()`
4. Only sync metadata is updated

### Change sync languages
1. Popup updates local settings
2. Background sees `syncLanguages` changed
3. Background calls `pushAll()`
4. All compact entries are rebuilt with the new language filter

---

## 13. Where to extend next

Likely future extension points:
- sync status indicator in popup
- user-visible sync diagnostics
- more explicit migration versions
- selective pull/push telemetry/debug tools
- more aggressive shard rebalancing if needed later

For now, the architecture is intentionally optimized for:
- reliability
- predictable behavior
- small, safe sync fast paths
- maintainable testing
