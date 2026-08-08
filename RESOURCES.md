# Browser Extension Network Boundaries Resources

Trusted sources for understanding how browser extensions read page state, communicate across extension contexts, and avoid page-context cross-origin issues.

## Knowledge

- [Chrome for Developers: Cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
  Canonical source for the rule that content scripts are still subject to same-origin rules, while extension service workers can fetch remote resources when `host_permissions` are declared. Use for: deciding where network requests should live.
- [Chrome for Developers: Message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
  Official guide to `chrome.runtime.sendMessage()` and background/content-script communication. Use for: understanding and designing the proxy boundary.
- [Chrome for Developers: Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
  Explains what content scripts can do, what they cannot do directly, and why they are the right place to read selected text from the DOM. Use for: page access vs extension privilege boundaries.
- [Chrome for Developers: Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
  Official explanation of `host_permissions` and permission scope. Use for: manifest design and permission reviews.
- [MDN: Same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy)
  Strong conceptual reference for what counts as a different origin and why browsers restrict cross-origin reads. Use for: mental model building.
- [MDN: CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)
  Detailed guide to how browsers decide whether JavaScript may read a cross-origin response. Use for: debugging browser-side fetch failures.

## Wisdom (Communities)

- [Chromium Extensions Google Group](https://groups.google.com/a/chromium.org/g/chromium-extensions)
  High-signal community for Chrome extension behavior, API edge cases, and platform changes. Use for: questions where official docs are incomplete or ambiguous.
- [Stack Overflow — google-chrome-extension](https://stackoverflow.com/questions/tagged/google-chrome-extension)
  Useful for practical edge cases and troubleshooting patterns, but answers should be validated against official docs. Use for: implementation debugging after checking the official references above.

## Gaps

- Firefox/WebExtensions differences are not yet covered here.
- MV2 historical behavior is out of scope unless the mission later requires migration context.
