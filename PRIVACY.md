# Privacy Policy — LODVault

**Last updated:** April 2025

LODVault is a browser extension for [lod.lu](https://lod.lu) — the official Luxembourgish Online Dictionary. This policy explains how the extension handles your data.

---

## What data LODVault stores

When you save a word, LODVault stores the following **locally in your browser** using `chrome.storage.local`:

- The word text and its URL on lod.lu
- The word's grammatical type, inflection, and example sentence (extracted from the page)
- Translations shown on the page (German, French, English, Portuguese, Dutch)
- Which lists the word belongs to: Favorites, Study, History
- Your personal note for the word (if you add one)
- Visit count and last visited date (if Auto mode is on)
- Your Auto mode on/off setting

This data never leaves your browser. It is not sent to any server, not shared with any third party, and not accessible to anyone other than you.

---

## What data LODVault does NOT collect

- No personal information (name, email, account)
- No browsing history beyond lod.lu article pages
- No analytics or usage telemetry
- No crash reports
- No advertising identifiers
- No payment information

---

## External requests

LODVault makes **no external network requests**. It does not contact any server, API, or third-party service. The only pages it interacts with are `lod.lu/artikel/*` pages — and only to read word content already visible on screen.

---

## Data storage and deletion

All data is stored in `chrome.storage.local` on your device. You can delete it at any time by:

- Removing individual words from the popup
- Uninstalling the extension (this deletes all stored data)

---

## Permissions used

| Permission | Why it is needed |
|---|---|
| `storage` | Saves your vocabulary words, notes, and settings locally in your browser |
| `tabs` | Detects which LOD article page is currently active so the popup can show the current word |
| `https://lod.lu/artikel/*` | Injects the save banner into LOD article pages and communicates with the active page |
| `https://www.lod.lu/artikel/*` | Same as above, for the www subdomain |

---

## Changes to this policy

If the extension is updated in a way that changes how data is handled, this document will be updated and the version number in the manifest will be incremented.

---

## Contact

For questions or concerns, open an issue at:  
[https://github.com/Mohammed-Ashour/lod-vault/issues](https://github.com/Mohammed-Ashour/lod-vault/issues)
