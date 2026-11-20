# Phase 1 blocker repair checks

Base: #75, f00a8f0c6dc3734d5d60c2d4032bee675136023e.

## Regression evidence

Before changing production sources, added schedule/practice, subsecond, exact-clock tie and same-day migration regressions. With dependencies installed, ran those tests against the original base sources: all four failed. Migration reproduced 3.173 versus 4.46685806. The corrected tests cover both merge directions, repeated application, practice history, independent pause and learning-step retention. A transport regression repeats three push/pull generations preserving precise scheduling and review clocks and practice kind. Existing legacy tuple, pause/undo, membership, missing-entry session and busy-undo tests remain in the full suite.

The ts-fsrs@4.7.1 fixture and independent reference-vector generator are unchanged; their provenance remains intact.

## Verification

- Serial suite: 394 tests passed, zero failures, versus 389 base tests.
- Background build passed; generated bundle included.
- Release lint: zero errors, notices or warnings.
- Chrome layout: 41 checks passed. First run encountered ENOTEMPTY in temporary-profile cleanup; retry exited successfully.
- Chrome actual action popup: passed, 435 × 510 host and 420px content across tested states. Initial runs encountered ENOTEMPTY cleanup failures; final retry exited successfully.

## Distribution and limits

These repairs are cumulative on #75. #66 at bca4a9a and #71 at 92e203f remain blocked. Backport the required cumulative storage, scheduling, session and recovery repairs to those branches, or distribute a cumulative successor incorporating #75. Do not treat either older head as repaired by this push.

Second-only legacy data cannot reconstruct event identity or milliseconds already discarded. Its ambiguous echo is suppressed against otherwise matching precise events in that second. New transport preserves milliseconds and response duration, but existing FSRS stability/difficulty quantization remains. Only the latest event travels over sync; older local history is retained, not fully replicated. Exact schedule-clock ties use a stable value ordering rather than claiming causal knowledge.

Optional-card queue support and broad UX remain incomplete. activity.js was not edited. These checks are evidence for a fresh review, not merge approval.
