# Sync compression (v4)

LODVault v1.2.0 introduced deflate-based compression for
`chrome.storage.sync`, increasing the effective word capacity from
~420 to ~2 500 words within the same 100 KB quota.

## Why

Chrome's sync storage is capped at **100 KB total** and **8 KB per
item**.  Before v4 every compact entry was stored as a raw JSON array
inside a shard — the repeated key names, object structure, and
boilerplate consumed a large share of the quota.

With compression those shards shrink by **83–84 %**, letting users
save **six times more words** before hitting the limit.

## How it works

Three layers work together:

### Layer 1 — compact entry format

Every entry is already reduced to single-letter keys and bitfield
flags before compression ever touches it:

```
Full entry                           Compact form
─────────────────────────────────    ───────────────────────
{                                    {
  "id":    "HAUS1",                    "i": "HAUS1",
  "word":  "Haus",                     "w": "Haus",
  "url":   "…/artikel/HAUS1",          "u": "HAUS1",
  "translations": {                    "t": {
    "english":  "house",                 "e": "house",
    "francais": "maison",                "f": "maison",
    "deutsch":  "Haus"                   "d": "Haus"
  },                                   },
  "favorite": true,                    "a": 7,
  "study":    true,
  "history":  true
}                                    }
```

### Layer 2 — deflate-raw

The compact JSON arrays have highly repetitive structure (same keys in
every entry, similar timestamps, predictable type tags).  We pipe
each shard through the browser's native `CompressionStream` in
`deflate-raw` mode — the same algorithm gzip uses, without the gzip
wrapper overhead:

```
shard JSON  →  TextEncoder  →  CompressionStream("deflate-raw")  →  raw bytes
```

Deflate exploits two kinds of redundancy:

- **LZ77 back-references** — repeated patterns like `{"i":"WORD00`
  appear dozens of times; deflate stores *(go back N bytes, copy M
  bytes)* instead of the full text.

- **Huffman coding** — frequently occurring bytes (`"`, `:`, `e`,
  digits) get shorter bit sequences; rare bytes get longer ones.

### Layer 3 — custom base64

`chrome.storage.sync` only accepts JSON-serialisable values.  Raw
deflate bytes can't be stored directly, so we encode them as base64
strings.

We use a **custom implementation** instead of `btoa`/`atob` because
Chrome extension Manifest V3 service workers **do not expose those
functions**.

The overhead is a fixed 33 % (3 input bytes → 4 output characters),
which is more than offset by the 80 %+ deflate savings on real data.

## The decision gate

Compression is **not always beneficial**.  A single-entry shard is so
small that the deflate headers + base64 overhead can make the result
*larger* than the original JSON.  The code checks:

```
if compressed_size < original_size → store compressed string
otherwise                           → store raw JSON array (v3 compat)
```

This means:

| Entries per shard | Stored format |
|-------------------|---------------|
| 1                 | Raw JSON array |
| 2+                | Compressed base64 string |

Both formats are detected transparently on read — if the stored value
is a `string` it's decompressed, otherwise it's treated as a v3
array.

## Migration (v3 → v4)

Existing users with uncompressed v3 data are migrated automatically
on the next sync cycle:

1. The manifest version mismatch (`v: 3` vs `v: 4`) is detected.
2. Data is pulled, decompressed (or read as-is for v3), and merged.
3. On repush, shards are compressed and the manifest is upgraded to
   `{ v: 4, z: 1 }`.

This is a one-time cost — subsequent syncs read and write compressed
data directly.

## Graceful fallback

If `CompressionStream` is not available (older browser, restricted
execution context), the entire system degrades to v3 behaviour:

- `compress()` returns the input unchanged.
- `decompress()` returns the input unchanged.
- The manifest omits the `z` flag.
- Sync continues working — just without the capacity increase.

## Capacity comparison

| Sync languages | Before (v3) | After (v4) |
|---------------|-------------|------------|
| 1             | ~990 words  | ~6 200 words |
| 2             | ~830 words  | ~5 200 words |
| 3             | ~700 words  | ~4 400 words |

*Estimates based on typical entries with short notes and examples.
Actual capacity varies with entry content.*

## Relevant files

| File | Role |
|------|------|
| `scripts/compress.js` | Compression / decompression module |
| `scripts/sync.js` | v4 format, shard compression, migration |
| `scripts/background.js` | Service worker boot |
| `scripts/popup-app.js` | Capacity bar in popup |
| `tests/compress.test.js` | Unit tests for compression |
| `tests/sync.test.js` | Integration tests for compressed sync |
