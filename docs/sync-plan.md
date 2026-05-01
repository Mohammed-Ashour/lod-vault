# LODVault Sync Plan

## Data Flow

```
chrome.storage.local (primary, verbose, unlimited)
  ↕ shared.js reads/writes (unchanged)
  ↕ SyncAdapter bridges
chrome.storage.sync (compact, sharded, 100 KB / 8 KB per item)
```

- `chrome.storage.local` is authoritative. Existing `shared.js` code doesn't change.
- `sync.js` runs in the background service worker — sole reader/writer of sync storage.
- Local storage keeps **all** translations. `syncLanguages` filter only applies to what goes into sync.

---

## Sync Format

### Entry mapping

| Local | Sync | Rule |
|---|---|---|
| `id` | `i` | as-is |
| `word` | `w` | as-is |
| `url` | `u` | strip `https://lod.lu/artikel/`; reconstruct on read |
| `pos` | `p` | omit if empty |
| `inflection` | `f` | omit if empty |
| `example` | `e` | omit if empty |
| `note` | `n` | omit if empty |
| `translations` | `t` | short keys, filtered by `syncLanguages`; omit if empty |
| `favorite` | `a` | bitflag: fav=1, study=2, hist=4 |
| `study` | `a` | packed into `a` |
| `history` | `a` | packed into `a` |
| `visitCount` | `c` | omit if 0 or 1 on history entries |
| `lastVisitedAt` | `l` | unix seconds; omit if empty |
| `createdAt` | `r` | unix seconds |
| `updatedAt` | `o` | unix seconds |

Translation key map: `en→e`, `fr→f`, `de→d`, `pt→p`, `nl→l`.

`syncLanguages` setting (default `["en","fr","de"]`, max 3): only these translations are included in compact entries. All translations stay in local storage. On merge, translations arriving from sync are merged without overwriting local-only ones.

### Key layout in `chrome.storage.sync`

| Key | Content |
|---|---|
| `lodVault.m` | `{ v:3, n:12, a:false, l:["e","f","d"], t:1714564800 }` |
| `lodVault.s` | `{ a:false, l:["en","fr","de"] }` |
| `lodVault.e.0` | `[ {i,w,u,...}, ... ]` |
| … | … |
| `lodVault.e.N` | `[ {i,w,u,...}, ... ]` |

`l` in manifest = compact keys used when shard data was written. `l` in settings = full language codes.

### Shard rules

- Sorted by `id`, filled up to 7,000 bytes per shard (margin under 8,192 limit).
- If any shard exceeds 6,500 bytes after a write, reshard all entries.
- Write new shards before deleting old ones.

---

## Capacity

| `syncLanguages` | Avg entry | ~Words in 100 KB |
|---|---|---|
| 3 (default) | ~140 B | ~700 |
| 2 | ~120 B | ~830 |
| 1 (en only) | ~100 B | ~990 |
| 5 (all) | ~170 B | ~580 |

---

## SyncAdapter API

```js
SyncAdapter = {
  init(),           // first-run: decide push/pull/merge
  pushAll(),        // local → sync (all entries + settings)
  pullAll(),        // sync → local (merge)
  pushEntry(id),    // push single entry (finds shard, rewrites it)
  pushSettings(),   // push settings only
  destroy()         // remove listeners
}
```

### Core functions

```js
compactEntry(localEntry, syncLanguages)   → compact object
expandEntry(syncEntry, localEntry?)        → local entry (merge translations)
compactTranslations(t, langs)              → { e:"...", f:"..." }
expandTranslations(compact, existing?)     → { en:"...", fr:"..." }  // merges existing
shardEntries(entryMap, syncLanguages)      → compact[][]
mergeEntryMaps(local, remote)              → entryMap
packFlags({fav, study, hist})             → number
unpackFlags(n)                            → {fav, study, hist}
compactUrl(url)                           → "HAUS1"
expandUrl(path)                           → "https://lod.lu/artikel/HAUS1"
isoToUnix(iso)                            → seconds
unixToIso(secs)                           → iso string
```

---

## Sync Flows

### Local → Sync (push)

Trigger: `chrome.storage.onChanged` for `area="local"`, debounced 2s.

```
1. Read lodVault.entries + lodVault.settings from local
2. Get syncLanguages (default ["en","fr","de"])
3. Compact entries (filter translations by syncLanguages)
4. Shard into ≤7 KB chunks
5. Write shards → sync.e.0 .. e.N
6. Write manifest → sync.m
7. Write settings → sync.s
8. Delete orphaned shard keys
```

### Sync → Local (pull/merge)

Trigger: `chrome.storage.onChanged` for `area="sync"`.

```
1. Read manifest from sync.m
2. Read all shards
3. Expand entries (merge translations with existing local)
4. Read current local entries
5. Merge: last-write-wins per entry (by updatedAt)
   - Translations: merge by key, preserve local-only langs
6. Add sync-only entries to local
7. Keep local-only entries unchanged
8. Write merged result to local
9. If merge changed anything, re-push to sync
```

### First-run (`init()`)

| Local | Sync | Action |
|---|---|---|
| Has data | Empty | Push local → sync |
| Empty | Has data | Pull sync → local |
| Both | Both | Merge (last-write-wins, translations merged across langs) |
| Empty | Empty | No-op |

Local `syncLanguages` setting takes precedence for future pushes. Pulled entries may contain langs not in local `syncLanguages` — those stay in local storage but aren't included in future pushes.

---

## Translation merge rule

**Never delete local translations.** If device A syncs with `[en,fr]` and device B has `[en,de]`, a pull from A gives B's local `{en:"house",de:"Haus"}` plus A's `{en:"house",fr:"maison"}`. Result: `{en:"house",fr:"maison",de:"Haus"}`. B then pushes with `[en,de]`, carrying only `{e:"house",d:"Haus"}`. Neither side loses data.

---

## Rate limits

`chrome.storage.sync`: max 1,200 writes/min total, 120 writes/min per item. Debounce push to 2s. On re-push after merge, add 2s delay.

---

## syncLanguages UI

New row in popup below auto-mode card:

```
Sync languages
Choose up to 3 languages to sync.
[EN ✓] [FR ✓] [DE ✓]  [PT ○] [NL ○]
3 of 3 selected
```

- `role="checkbox"`, `aria-checked`, `aria-disabled`
- Max 3 checked; remaining chips disable. Min 1 checked.
- Labels from `TRANSLATION_LANGUAGE_LABELS`.
- Save immediately on change → triggers sync push.
- Below chips: capacity hint ("~500 words synced").

---

## Settings schema

```js
DEFAULT_SETTINGS = {
  autoMode: false,
  syncLanguages: ["en", "fr", "de"]
}
MAX_SYNC_LANGUAGES = 3
```

`normalizeSettings` validates: must be array of valid codes, length 1–3, deduplicated, defaulting to `["en","fr","de"]`.

New functions in `shared.js`:
- `getSyncLanguages()` → string[]
- `setSyncLanguages(langs)` → string[]

---

## File changes

| File | Action |
|---|---|
| `scripts/sync.js` | **New** — SyncAdapter, serialization, sharding, merge |
| `scripts/background.js` | **Modify** — importScripts sync.js, init on onInstalled |
| `scripts/shared.js` | **Modify** — add syncLanguages to settings, getSyncLanguages, setSyncLanguages, SYNC_LANG maps |
| `pages/popup.html` | **Modify** — add sync-languages row |
| `scripts/popup.js` | **Modify** — bind sync-languages UI |
| `styles/popup.css` | **Modify** — style sync-languages row |
| `manifest.json` | No change (`"storage"` covers sync) |
| `scripts/content.js` | No change |
| `tests/sync.test.js` | **New** — all serialization, merge, shard tests |
| `tests/helpers/loaders.js` | **Modify** — add sync mock, update shared store for syncLanguages |

---

## Edge cases

| Case | Handling |
|---|---|
| Sync quota exceeded | Catch error, log warning, continue using local. No user block. |
| Sync unavailable (signed out) | Graceful fallback to local-only. No UI error. |
| Format version change | Manifest `v` field. Migrate on pull if mismatch. |
| Partial shard read | Merge what's available. Log warning. Don't delete local data. |
| Service worker killed | Stateless adapter. Re-register listeners on wake. Idempotent init. |
| Cross-device different syncLanguages | Local langs preserved on merge. Each device pushes with its own filter. |

---

## Rollout

### Phase 1 — Core
- [ ] `scripts/sync.js`: compactEntry, expandEntry, compactTranslations, expandTranslations, packFlags, unpackFlags, compactUrl, expandUrl, isoToUnix, unixToIso, shardEntries, mergeEntryMaps
- [ ] `shared.js`: syncLanguages in DEFAULT_SETTINGS, MAX_SYNC_LANGUAGES, SYNC_LANG maps, normalizeSettings validation, getSyncLanguages, setSyncLanguages
- [ ] Unit tests: roundtrip, bitflags, timestamps, URL, translation filtering/merging, shard sizing, merge conflicts, syncLanguages validation
- [ ] SyncAdapter.pushAll, pullAll, init
- [ ] background.js: importScripts + init on onInstalled

### Phase 2 — Live sync + UI
- [ ] `chrome.storage.onChanged` listener: local→sync (debounced), sync→local
- [ ] Settings sync: autoMode + syncLanguages
- [ ] popup.html/js/css: sync-languages selector UI
- [ ] Integration tests: push→pull roundtrip, cross-device syncLanguages

### Phase 3 — Robustness
- [ ] Quota exceeded handling
- [ ] Partial shard reads
- [ ] Format version migration
- [ ] Stress test 500+ entries
- [ ] Sync status indicator (optional)

### Phase 4 — Shard-level sync (optional)
- [ ] Push only affected shard on mutation
- [ ] Map entry.id → shard index