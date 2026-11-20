# Serialize tag writes across extension contexts

In the context of whole-record tag storage, facing lost updates between pages and background sync, I decided to use an origin-scoped Web Lock around the complete read-modify-write, accepting that unsupported runtimes must refuse edits.

## Options considered
| Option | Benefit | Cost |
| --- | --- | --- |
| Web Lock | Shares serialization across pages and worker without messaging | Requires Locks API |
| Background mutation queue | Single writer | Requires new message protocol and safe port-failure handling |

## Decision
Use Web Locks because all current extension contexts share an origin. Refuse mutations when unavailable rather than silently providing a per-page guarantee. Remote merges take the same lock. Read-only rendering remains available.

Quota status is derived from the exact compact payload and reports omitted live tags, decks and deletion records. Deferred deletions are explicitly warned about rather than claiming propagation.
