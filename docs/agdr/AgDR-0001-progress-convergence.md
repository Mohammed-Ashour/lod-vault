---
id: AgDR-0001
status: executed
trigger: user-prompt
---
# Independent progress clocks

> In the context of multi-device progress, facing practice overwriting schedules and second-resolution collisions, I decided to merge schedule, history and pause independently with exact clocks and deterministic ties, accepting additive transport fields.

## Context
- Store-core merges normalized records; sync carries only the latest event.
- Legacy devices retain second-resolution tuples.

## Options considered
| Option | Pros | Cons |
|---|---|---|
| Whole-record latest review | Small implementation | Practice destroys newer schedules |
| Independent clocks and stable value ties | Converges without new service | Requires precise optional transport fields |

## Decision
Chosen: independent clocks, because practice is not a scheduling mutation. Preserve milliseconds in additive fields. For legacy second-only events, suppress an ambiguous duplicate when an otherwise matching precise event exists in that second. Exact event ties use event attributes; schedule ties use normalized schedule values, not local preference.

## Consequences
- Legacy ambiguity cannot reconstruct lost identity.
- Existing rounded FSRS transport values remain compatible.
- Repairs are cumulative on #75. #66 at bca4a9a and #71 at 92e203f remain blocked until the required repairs are backported or distributed through a cumulative successor. Passing checks is not merge approval.
- Optional-card queues and broad UX remain incomplete.
