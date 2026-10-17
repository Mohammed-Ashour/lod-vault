# UI consolidation proposal

Status: implemented on this branch after prototype approval. See [the actual before/after walkthrough](ui-consolidation-before-after.html). Scope is Popup, Vault and Flashcards. LOD Lens and the article banner are not redesigned or claimed audited here.

- Branch: `feature/ui-consolidation-prototype`
- Base: updated `main` / `origin/main`, `93621c6`
- Review date: 2026-10-17
- Open [the interactive prototype](ui-consolidation-prototype.html), or run `open docs/ui-consolidation-prototype.html` on macOS.
- Decision: [AgDR-0001](agdr/AgDR-0001-ui-consolidation-preview.md)

## Direction

Keep LODVault's Blue Night identity: navy/cool-paper surfaces, teal actions, Georgia word headings and native UI text. This is a layout and interaction consolidation, not a rebrand.

The popup should have a predictable frame. Changing search source should change results, not its dimensions or the location of search. Favorite and Study should mean the same thing in every view.

```text
Popup, proposed 420 × 600px
├── Header, Today, Words / Stats & data       fixed
├── My vault / Search LOD                    fixed within Words
├── Full-width search                       fixed
├── Count + local status / language          same-height row
├── Content                                 only content scrolls
│   ├── Current LOD word                    expandable, both sources
│   └── Consistent word rows or state
└── Feedback + Undo                         reserved space
```

The target height must shrink to available space. A standalone HTML preview cannot prove browser-owned extension-window sizing. The implementation now checks the loaded Chrome action popup separately. Its preferred content size is 420 × 600px, but Chrome may clamp height and add host gutter space. Firefox still needs a manual check.

## Findings and proposed fixes

Measurements below came from Chrome rendering the real pages with the repository's isolated `scripts/screenshot-stub.mjs` fixtures, not the user's vault. The popup used a 420 × 600 viewport. Companion pages used 375 × 740. Numbers describe page-content geometry, not a measured browser-owned popup frame.

### 1. The popup's width rule is currently invalid

**Evidence:** `styles/popup.css:1-14` ends an introductory comment without opening it. Chrome drops the first body rule, including `width: 420px` and `min-height: 480px`. At an 800px emulated viewport, the body expanded to 785px instead of 420px.

**Proposal:** repair the comment first. Give the popup a bounded width and height, then make one child own scrolling. Reserve the scrollbar gutter inside that child. Do not use root overflow hiding to conceal oversize content.

**Acceptance:** a source switch, lookup completion, empty result, settings disclosure or long note cannot change the outer frame or produce horizontal overflow. Test on a short display and at increased browser zoom.

### 2. Source switching removes part of the current-word UI

**Evidence:** `scripts/popup-lookup.js:125-148` toggles `is-lookup-context`; `styles/popup.css:301-302` hides the current word's actions and note. In the seeded Chrome page, the search box moved from y=449.8 to y=315.0, approximately 135px. Removing the page scrollbar also changed content width from 405px to 420px.

**Proposal:** move the current-page disclosure below search, inside the content scroller. Keep its actions available in both sources. Search source must not determine whether a note editor exists.

**Acceptance:** the search input and source selector have identical bounding rectangles before and after switching. Keep each source's query, scroll position, expanded details and note draft. Opening a disclosure may move other results, never search.

### 3. The status count resizes search

**Evidence:** `pages/popup.html:75-82` places search and its status in the same flex row. `styles/popup.css:249-278` gives status non-shrinking width. In the fixture, searching Haus changed input-container width from 323.3px to 280.9px, approximately 42px.

**Proposal:** use a full-width input and a separate fixed-height metadata row. Show count on the left and local-only status or dictionary language on the right.

**Acceptance:** “5 saved words”, “Searching…”, “20 matches” and errors cannot change input width. Language options fit without moving the input or results boundary.

### 4. Word controls diverge across sources

**Evidence:** `scripts/popup-list.js:44-72` renders Fav/Study alongside a 17px heading. `scripts/popup-lookup.js:26-39` renders a primary Save to Favorites action alongside a 24px heading, then repeats memberships inside expanded details. The corresponding CSS is in `styles/popup.css:333-346` and `styles/popup.css:363-389`.

**Proposal:** a shared presentation contract: 22px word heading, pronunciation, part of speech, translation, independent Favorite/Study controls, explicit “In vault” status and one example/note disclosure. Retain contextual differences such as history metadata. Do not introduce a generic component framework just to share markup.

**Acceptance:** Study-only and history-only words never appear as Favorites. Adding a new dictionary word still fetches the canonical entry before saving. Removing one membership must not delete the entry or silently enable the other. A note remains intact when switching sources.

The prototype uses equivalent offline markup across Popup and Vault. Whether production markup should be shared through `entry-presenter.js` needs a focused follow-up decision after approval, not a premature rewrite.

### 5. Keyboard roles and feedback need consistent behavior

**Evidence:** the tabs and source buttons in `pages/popup.html:33-35,70-72` declare tab/radio roles. `scripts/popup.js` handles tab clicks but no arrow-key navigation; `scripts/popup-lookup.js` likewise lacks source-group arrow keys. `styles/blue-night.css:293-328` positions both feedback and Undo at the same fixed bottom coordinate. Simultaneous toast overlap is a code-backed risk, not a separately reproduced user report.

**Proposal:** roving tab stops and Left/Right/Home/End support for both groups. Keep focus on the action after its state changes. Use a reserved feedback row with an independently available Undo action instead of competing bottom overlays. Use readable muted colors in both themes.

**Acceptance:** keyboard-only users can select sources, search, expand, save, edit notes and undo. Announce status without stealing focus. Feedback cannot obscure the final result. Preserve existing note-recovery and asynchronous save protections.

### 6. Narrow companion pages have incorrect layout budgets

**Evidence:** in a 375px viewport, Flashcards produced a 409px document scroll width. Header items, the 300px Session menu and minimum-width grading controls need explicit narrow-screen handling. Relevant rules: `styles/blue-night.css:118-139`, `styles/flashcards.css:18,308`.

The Vault header wrapped to approximately 179px, while `styles/preview.css:26-27` assumes a 116px header when sizing the iframe. The desktop rule assumes 64px. Toolbar content can exceed either assumption.

**Proposal:** let header titles/actions wrap deliberately. Bound settings to the available width. Use three `minmax(0, 1fr)` grading columns. Give Vault's shell a flex/grid-owned remaining-height iframe instead of subtracting guessed header heights.

**Acceptance:** at 360px and 375px, all grading controls and toolbar actions remain reachable without sideways scrolling. Long translations and notes wrap. Test the real Vault iframe separately, including its export document and note editors. The prototype's inline Vault is only a layout sketch, not an iframe implementation.

## Prototype coverage

The single HTML file works offline without dependencies, production scripts or real extension storage.

- Popup, Vault and Flashcards layout previews.
- Dark/light palette and standard/narrow shell controls.
- Independent local and dictionary queries, local note drafts and source-specific scroll positions.
- Matching Favorite/Study controls, an unsaved “moien” fixture, remove/Undo and simple simulated review.
- Loading, first lookup, no matches, unavailable LOD and long-content fixtures.
- Arrow-key navigation and session-settings Escape handling.

Five saved words mirror repository screenshot fixtures. The unsaved greeting and long entry are explicitly illustrative. Language changes demonstrate layout; only EN, FR and DE have fixture translations. Sync, export, backup, pronunciation and review outcomes are simulations, not implemented services.

## Production boundaries

Architecture context came from `README.md`, `docs/direct-lod-search-review.md` and verified source files. The implementation adds [ARCHITECTURE.md](../ARCHITECTURE.md) to record these boundaries.

- `pages/popup.html` owns popup structure; `styles/popup.css` owns its layout.
- `styles/blue-night.css` supplies shared theme tokens and controls.
- `scripts/popup-app.js` wires current-page, saved-list, lookup, study, sync and backup modules.
- `scripts/popup-lookup.js` owns dictionary lookup, stale-request protection, canonical entry hydration and lookup note recovery.
- `scripts/popup-list.js` owns local filtering and saved-entry presentation.
- `scripts/preview.js` owns the Vault iframe and edit-state preservation; `scripts/flashcards.js` owns review behavior.

Do not change storage schemas, API contracts, note autosave/recovery, background mutations, dictionary privacy or review scheduling as part of this UI pass. Keep local search local. Retain canonical-entry fetching, request invalidation and existing asynchronous regression tests.

`ARCHITECTURE.md` records the existing runtime entry points and module ownership, plus the new popup scroll/feedback contract and remaining-height Vault layout. No storage or API boundaries changed.

## Implementation sequence

1. Repair popup sizing and scroll ownership. Add browser-level geometry checks for source/section/state changes before restyling.
2. Reposition current-page details; stabilize search metadata and source-state retention. Keep the existing two-level navigation.
3. Consolidate word presentation and feedback. Add keyboard and focus checks while preserving note and membership behavior.
4. Repair narrow Vault and Flashcards layouts. Check real iframe state retention and grading controls.
5. Verify Chrome and Firefox with short/tall windows, both themes, long translations, slow/offline LOD, large vaults, unsaved notes, external storage changes and delete/Undo.

The user approved implementation on 2026-10-17. The fixed frame, search-first ordering, current-word disclosure, aligned Favorite/Study actions and companion-page layout fixes are implemented. The existing modules retain their responsibilities. Production status and Undo share a footer below the scroller. It collapses while idle, so results keep the space; appearing never moves search. On displays at or below 420px high, Today yields its space to results; Flashcards remains available in the header.

## Prototype-stage verification

- Chrome prototype checks: 41 assertions passed. Covered stable frame/search geometry across five states, independent queries, scroll/detail/note retention, Favorite versus Study, save/remove/Undo, Retry/local fallback, keyboard navigation, narrow page layouts, review reveal and themes.
- Inspected prototype desktop and 375px review-page screenshots. No horizontal document overflow at 375px. The inner shell contracts to 336px with review-page gutters and a reserved outer scrollbar.
- Production-page observations used browser/storage stubs. No real API calls or user data were needed.
- `npm test`: 246 passed, zero failures. This is the unchanged production baseline, not evidence that proposed production fixes are implemented.
- UI scanner on the prototype: zero findings. This does not replace layout checks.
- `git diff --check`: passed. Review artifacts are new files; production files are unchanged.
- At the prototype stage, Firefox rendering, actual browser-owned extension popup sizing, live API behavior, screen-reader output and zoom behavior were not verified.

## Implementation verification

- `npm test`: 254 passed, zero failures. Includes unchanged lookup hydration/note-recovery tests and new editor retention, source interruption, keyboard and menu tests.
- `npm run test:ui -- --capture`: 38 real-page Chrome checks passed. Covers fixed popup/search geometry; visible first-result actions; source/editor retention; loading/empty/offline/long content; light theme; separate Undo/status rows; 480px and 360px-tall windows; 360px, 375px and 1280px companion layouts; native Enter and Escape menu behavior.
- `npm run lint`: Firefox package has zero errors, warnings or notices.
- UI scanner: zero findings in production styles and the before/after HTML. Existing identity and type choices remain intentional.
- [Exact before/after measurements](screenshots/ui-consolidation/measurements.json): search shift 134.8px to 0; source width change 15px to 0; count-induced input shrink 42.4px to 0; Flashcards overflow 49px to 0; Vault iframe overhang 62.7px to 0.
- Screenshots render the real production page files with isolated fixtures. Baseline files come from `93621c6`; after files come from this branch. They are not recreated mockups.
- `npm run test:popup`: the extension loaded through Chrome's debugging-pipe `Extensions.loadUnpacked` API in a disposable profile. Its actual action window stayed 435 × 498px with 420px content across idle, populated, empty, error, loading and expanded settings. Chrome clamps the host height and adds gutter space in this headless environment. The check caught and prevented circular viewport-based root auto-sizing that page emulation missed.
- Root dimensions establish Chrome's preferred size. Only the bounded inner app follows the available viewport. Root overflow is disabled for this frame contract, not to conceal overflowing result content. Separate checks assert content wrapping and reachable controls.
- Firefox UI, screen-reader output and increased zoom remain manual checks. Package lint is not Firefox UI verification.
- No user vault data or existing untracked research files were included in the change.
