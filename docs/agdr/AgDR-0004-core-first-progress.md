---
id: AgDR-0004
timestamp: 2026-11-21T00:00:00Z
trigger: user-prompt
status: executed
---

# Core-first progress retention

In the context of bounded progress sync, facing newer skill records evicting core progress, retain core records before skills to preserve existing schedules, accepting extra payload compression near the quota boundary.

## Context
- Progress has a separate capped budget after words and activity.
- Skill IDs resolve to saved words through `baseCardId`.

## Options considered
| Option | Benefit | Cost |
|---|---|---|
| Sort then proportional trimming | Few compressions | Can remove core records even when core alone fits |
| Remove skills individually before trimming core | Core-only payload remains eligible unchanged | More compressions near capacity |

## Decision
Remove skills individually before trimming core because optional progress must never displace core progress. Keep existing recency ordering within each group and existing core-only trimming.

## Consequences
Skills survive when the complete payload fits. Deleted base entries remain filtered. No sync format or version change is needed.
