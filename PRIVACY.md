# Privacy Policy — LODVault

**Last updated:** October 2026

LODVault is a browser extension for [lod.lu](https://lod.lu) — the official Luxembourgish Online Dictionary. This policy explains how the extension handles your data.

---

## What data LODVault stores

When you save a word, LODVault stores the following **locally in your browser** using `chrome.storage.local`:

- The word text and its URL on lod.lu
- The word's grammatical type, inflection, and example sentence, read from a LOD page or fetched from the LOD API
- Available translations in German, French, English, Portuguese, and Dutch
- Which lists the word belongs to: Favorites, Study, History
- Your personal note for the word (if you add one)
- Visit count and last visited date (if Auto mode is on)
- Your Auto mode on/off setting
- If you manually trigger **Import history**, matching `lod.lu/artikel/*` URLs from your browser history are read once and only missing words are added to your vault

LODVault does not upload your vault or personal notes to LOD or to an extension-operated server. If you enable browser sync, your browser stores a compact replica through its own sync service. Manual exports and backups create files on your device.

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

LODVault contacts `https://lod.lu` to retrieve dictionary content and pronunciation audio:

- **Search LOD** sends the text you type and the selected search language to the LOD API. All-languages search sends that same text for each supported language. Results load after a short typing pause or when you press Enter.
- Expanding or saving a result sends its LOD article ID to retrieve the full dictionary entry.
- **LOD Lens** sends only the word or text you explicitly select for lookup. It does not send the surrounding page contents.
- Playing pronunciation requests the corresponding audio file. Browser-history import may fetch missing dictionary entries by their article IDs.

LOD receives these requests and the connection information normally available to a website, such as your IP address. LODVault does not send your personal notes, vault contents, or full page contents with dictionary requests. **My vault** search filters saved words locally without contacting LOD.

LODVault has no analytics or tracking service and no extension-operated backend.

---

## Data storage and deletion

All data is stored in `chrome.storage.local` on your device. If you use the extension's sync feature, a compact replica may also be stored in `chrome.storage.sync`. You can delete your data at any time by:

- Removing individual words from the popup
- Uninstalling the extension (this deletes all stored local data, and in Chrome it may also remove the extension's sync data)

If you want a portable backup before uninstalling, use **Backup JSON** from the popup first.

---

## Permissions used

| Permission | Why it is needed |
|---|---|
| `storage` | Saves your vocabulary words, notes, and settings locally in your browser |
| `tabs` | Detects which LOD article page is currently active so the popup can show the current word |
| `https://lod.lu/artikel/*` | Injects the save banner into LOD article pages and communicates with the active page |
| `https://www.lod.lu/artikel/*` | Same as above, for the www subdomain |
| `https://lod.lu/api/*` | Retrieves dictionary search results and complete entries for Search LOD and LOD Lens |
| `https://lod.lu/uploads/*` | Plays dictionary pronunciation audio when requested |
| `history` (optional) | Only when you click **Import history**; reads `lod.lu/artikel/*` visits to add missing words (add-only, non-destructive) |

---

## Changes to this policy

If the extension is updated in a way that changes how data is handled, this document will be updated and the version number in the manifest will be incremented.

---

## Contact

For questions or concerns, open an issue at:  
[https://github.com/Mohammed-Ashour/lod-vault/issues](https://github.com/Mohammed-Ashour/lod-vault/issues)
