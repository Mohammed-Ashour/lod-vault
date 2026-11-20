# Writing answers on core cards

In the context of shipping existing exercises in Flashcards, I decided to offer writing as a core-card review mode, accepting that optional skill queues need a separate integration.

## Options considered

| Option | Benefit | Cost |
| --- | --- | --- |
| Core review mode | Reuses verified retry, undo and activity writes | No separate writing schedule |
| Separate reverse skill queue | Independent progress | Requires sibling burial and queue migration |

## Decision

Use the existing produce exercise on core cards because mode selection should not change the established session contract. Load cached dictionary details before mounting. Do not invent answers when details are missing. Optional skill cards are not enabled by this change.
