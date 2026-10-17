---
id: AgDR-0001
timestamp: 2026-10-17T14:25:00Z
agent: pi
model: gpt-6.1-sol
session: 01a14a30-0ee2-72b7-a867-52ff36158ca2
trigger: user-prompt
status: executed
---

# Stabilize the existing UI before redesigning navigation

> In the context of LODVault's popup and companion pages, facing layout shifts when changing search source, I decided to prototype a bounded popup with fixed search controls and shared word actions to make switching sources predictable, accepting less space for results on short screens.

## Context
- The user requested a branch from updated main and an HTML direction review before production changes.
- Baseline is `93621c6`. The extension uses plain HTML, CSS and JavaScript, with shared Blue Night tokens in `styles/blue-night.css`.
- A malformed opening comment in `styles/popup.css` invalidates its first body rule. Source switching also hides the capture card's actions and notes.
- Chrome checks with isolated storage fixtures show a roughly 135px search-position shift, a 15px scrollbar-width change, and narrow Flashcards overflow.

## Options considered

| Option | Pros | Cons |
|--------|------|------|
| Repair width and hidden-context rules only | Smallest patch; preserves all existing markup | Content still sets popup height; counts still resize search; inconsistent entry actions remain |
| Keep navigation, bound the popup, stabilize search and unify actions | Fixes geometry and interaction inconsistencies without replacing the product structure | Requires explicit scroll ownership and short-screen testing |
| Replace nested navigation with a single workspace navigation | Fewer navigation levels | Larger behavior change; mixes section navigation with search-source selection |

## Decision

Chosen: **keep navigation and stabilize the layout**, because Words/Stats and My vault/Search LOD already express distinct tasks. Keep the navy/teal palette, Georgia entry headings and native UI font. Move current-page detail below search into the scrollable content rather than removing controls when the source changes.

First produce a dependency-free, offline HTML prototype. The user then approved production implementation on 2026-10-17. See AgDR-0002 for the implementation boundary.

## Consequences
- Proposed popup target: 420px wide, 600px tall, bounded by available viewport height. Exact extension-window sizing needs Chrome and Firefox validation before implementation.
- Search, navigation and a reserved feedback row remain outside the content scroller. Counts and language selection use their own stable row.
- Favorite and Study remain independent memberships. Never represent every saved word as a Favorite.
- Preserve separate queries, scroll positions, open details and note drafts across source changes.
- No new dependencies, framework, storage schema, API behavior or telemetry.

## Artifacts
- `docs/ui-consolidation-prototype.html`
- `docs/ui-consolidation-review.md`
