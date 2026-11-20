---
id: AgDR-0001
timestamp: 2026-10-17T00:00:00Z
trigger: user-prompt
status: executed
---

# Durable activity capture

> In the context of capped review logs and offline devices, facing permanent lost daily counts, I decided to capture per-device daily counters at the review write to count work independently of schedule replication, accepting a larger sync record.

## Context
- The background log scan cannot recover reviews beyond 100 per card.
- Schedule replication keeps only the winning schedule, not every review.
- Activity writes and review writes must not race within the background worker.

## Options Considered
| Option | Pros | Cons |
|--------|------|------|
| Deduplicated events | Exact undo by event | Unbounded daily payload |
| Per-device daily counters | Compact, commutative merge | Requires stable identity and explicit undo contract |

## Decision
Chosen: per-device counters, because storage grows with days and devices rather than reviews. Preserve legacy totals as a max-merged floor. Snapshot that floor once, then add new counters. Older clients can read projected `d` totals; their later additions cannot be distinguished from overlapping history and remain a conservative floor.

## Consequences
- A narrow `captureReview({date,isNew}, persist)` hook runs inside the store mutation queue and the activity queue. An origin-scoped Web Lock also serializes writes from separate extension pages and the worker; runtimes without Web Locks only have per-context serialization. `persist(extra)` writes metadata, activity and local-only device identity in one storage set. No scheduler changes.
- Phase 1 must use the hook for each successful review. Activity counts actual attempts, so scheduling undo intentionally leaves the performed attempt counted. This branch has no undo mutation. Historical activity survives card deletion and resurrection. New introductions count per device; globally distinct-new counting remains unimplemented.
- Legacy retained logs are a lower bound, never reconstructed as exact history. Migration cannot recover already lost reviews.
- Sync item limits remain authoritative. Many devices can exceed the item limit; never silently discard components to fit. Oversized records pause sync through the existing sync preflight rather than lose counters. Sharding remains unimplemented.

## Artifacts
- scripts/activity.js
- scripts/store-core.js
