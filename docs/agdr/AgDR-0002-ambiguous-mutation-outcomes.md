# Ambiguous mutation outcomes

In the context of worker mutations losing their replies, I decided not to replay ambiguous failures, accepting an unresolved UI outcome rather than duplicate writes.

## Options considered

| Option | Benefit | Cost |
| --- | --- | --- |
| Propagate ambiguous failure | Small change; no automatic duplicate | User must reload and inspect saved progress |
| Durable operation IDs | Safe retries | New persistent protocol and retention policy |

## Decision

Only a transport failure proving no receiver permits local fallback. Worker error responses never permit fallback. No durable retry protocol is added. Review failure stops the session and asks the user to reload rather than offering another rating.

The optional Phase 3 captureReview hook supplies additional storage keys to the same metadata write. Without that module, metadata persistence remains unchanged.
