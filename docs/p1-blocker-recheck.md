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


## Lost worker reply follow-up

All store mutations now use local fallback only for transport errors reporting no receiver or an impossible connection. A closed port, absent response or explicit worker error is not replayed. This covers review, undo, pause, visit counters, imports and all other runStoreMutation callers. There are no automatic retries or operation IDs. The outcome can remain unknown after a lost reply. Reload and inspect saved progress; do not assume the write failed. Flashcards blocks further grades on that page, announces the uncertainty and does not append a confirmed session result.

The optional Phase 3 captureReview hook receives pre-review metadata and persists its activity/device keys together with the new review metadata in one storage.local.set. The no-activity path remains supported. The contract was inspected at #67 head 17700587a5d69a71c85b0c73b68dd5c30a9a095c. No Phase 3 modules were copied or edited.

Verification: new mutation, hook and UI regressions failed against 0020a03 before applying the fix. Final npm test passes 398 tests with the opt-in combined test skipped. Supplying PHASE3_ACTIVITY_SOURCE=/tmp/p1-phase3-activity.js runs all four mutation tests successfully using the actual #67 activity source extracted with git show. A committed review followed by a lost reply leaves totalReviews=1 and activity=[1,1,0]. This is a narrow combined contract fixture, not approval of a fully integrated Phase 1/2/3 build. Atomic-write hook assertions also pass. The existing schedule/practice, subsecond distinct-event, equal-clock tie, repeated sync and reference-backed same-day migration tests pass in the full suite.

Build and release lint pass with zero errors, warnings or notices. Chromium reports all 41 layout assertions passing, but test:ui exits nonzero during temporary-profile cleanup with ENOTEMPTY. Native popup verification passes on rerun. This is implementation verification, not independent review approval. No new error-state screenshots or recording were produced. #66 and #71 remain blocked until these fixes are distributed and independently reviewed. Full combined integration and the previously documented unfinished Phase 1 UI scope remain pending.
