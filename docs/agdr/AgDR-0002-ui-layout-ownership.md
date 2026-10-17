---
id: AgDR-0002
timestamp: 2026-10-17T14:25:00Z
agent: pi
model: gpt-6.1-sol
trigger: user-prompt
status: executed
---

# Keep UI consolidation within the existing modules

> In the context of the approved UI prototype, facing source-switch movement and inconsistent actions, I decided to retain the existing module boundaries and consolidate layout and interaction contracts to fix the UI without changing persistence or dictionary hydration, accepting separate local and lookup markup.

## Context
- The user approved implementation and requested a PR with a before/after walkthrough.
- Popup local filtering and remote lookup have different draft, request and hydration lifecycles.
- The shared entry presenter also generates exported HTML. Migrating all markup there would broaden the change beyond the approved UI fixes.

## Options considered

| Option | Pros | Cons |
|--------|------|------|
| Move all row markup to the shared presenter | One markup implementation | Couples exports, local rows and remote hydration; larger regression boundary |
| Keep module ownership, align CSS and action semantics | Preserves request/note safeguards; smaller production change | Some markup remains duplicated |

## Decision

Choose existing module ownership because local and dictionary rows do not share the same loading and recovery lifecycle. Share sizing, action labels, focus behavior and layout rules instead of introducing a new rendering framework.

Use a bounded popup shell with fixed search controls, one content scroller, and reserved feedback/Undo rows. Retain remote result DOM on a source round trip when the query/language has not changed. Invalidate and reissue requests interrupted during loading.

## Consequences
- No storage, permissions, dictionary API or scheduling changes.
- Canonical entries are still fetched before new dictionary saves.
- Local and remote note editors retain their existing autosave controller.
- Vault iframe height follows the actual header height; Flashcards controls wrap at narrow widths.
- Verify actual pages with isolated fixtures, unit tests and package lint. Document browser limitations rather than claiming unrun checks.

## Artifacts
- `docs/ui-consolidation-before-after.html`
- `docs/ui-consolidation-review.md`
