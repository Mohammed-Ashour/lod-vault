---
id: AgDR-0005
status: proposed
trigger: user-prompt
---

# Exercise session modes

> In the context of existing exercise components and a working core Writing session, facing repeated incomplete integration, I decided to expose dictionary-backed exercises as session modes to deliver usable questions, accepting a shared word schedule instead of independent skill schedules.

## Context
- Flashcards already persists modes and routes Writing grades through retries, undo and atomic review storage.
- The registry defines data requirements; exercises report grades without storage writes.

## Options considered
| Option | Pros | Cons |
| --- | --- | --- |
| Separate skill queues and schedules | Independent memory estimates | Changes queue identity, counts, resume and sync contracts |
| Exercise session modes on core cards | Reuses verified review lifecycle; immediately selectable | All modes share the word's schedule |

## Decision
Choose session modes because they connect the requested exercises without replacing the session engine. Keep the shared schedule visible in help text. Unsupported exercise data falls back explicitly to word writing, or offers Self review when no writing data exists. Independent skill queues remain unimplemented, not advertised as delivered.

## Consequences
- Grades use core IDs and existing Today/practice rules.
- No unlock or sibling-burial rules are claimed for separate skill cards.
- Integration tests cover actual selected modes and grading.
