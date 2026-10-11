# Direct LOD search review

## Implemented design

Option 02 from `docs/direct-lod-search-prototypes.html`. The existing Words tab now has a **My vault / Search LOD** source switch. Vault filtering stays local. Dictionary search supports Luxembourgish, English, French, German, Portuguese, Dutch, and an all-languages search.

Search previews never save themselves. **Save to Favorites** fetches the canonical entry first. Expanded entries also offer Study, translations, an example, and notes. Dictionary lookup does not record a visit. Existing memberships and notes survive enrichment.

Main implementation: `scripts/popup-lookup.js`, wired through `scripts/popup-app.js` and `pages/popup.html`.

## Review results

Independent read-only correctness and UX/privacy reviewers examined the implementation, followed by a focused verification review. Their reported issues were addressed with regression tests:

- Drain all note editors before replacing results, including edits made while another editor's save is pending.
- Preserve drafts when another view deletes a word. Offer explicit save-again or discard actions rather than blocking search indefinitely or silently restoring Study.
- Reset the restored editor's saved-value baseline before flushing its draft, including a draft reverted to its pre-deletion value.
- Merge each query's matched translations with cached canonical entry data so a later Dutch lookup retains its translation.
- Preserve keyboard focus during storage refreshes and restore it after a failed Save.
- Give the language selector a visible focus outline.
- Derive membership feedback from the mutation result.
- Update the published privacy policy to describe dictionary requests accurately.

Reviewers had read-only access and did not run tests. The implementation agent ran the checks below after applying the fixes. The last saved-value correction was verified by its regression test and the full suite, not another reviewer pass.

## Validation

- `npm test`: 246 passed, zero failures.
- `npm run lint`: Firefox release package has zero errors, warnings, or notices. The release archives include the new lookup module.
- Chrome loaded the actual popup scripts with isolated browser/storage stubs and requests forwarded through the production URL validator to live LOD responses. Checks covered multilingual lookup, full-entry saving, notes, offline vault filtering, API error/retry, keyboard focus after failed Save, and popup-width layout.
- Browser checks made no changes to the user's real vault. Firefox UI behavior was not manually tested.
- `git diff --check`: passed.
