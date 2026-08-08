# Mission: Browser Extension Network Boundaries in LODVault

## Why
Learn this part of LODVault well enough to maintain and extend the selected-text lookup flow without breaking the security boundary between page code, content scripts, the background service worker, and the LOD API.

## Success looks like
- Trace the selected-text flow from page selection to rendered LOD result.
- Change or extend the lens lookup behavior without accidentally moving privileged network work into page context.
- Review and harden the background proxy path with confidence.

## Constraints
- Keep the focus on the current LODVault codebase and its Manifest V3 architecture.
- Prefer practical understanding tied to this repo over broad browser-extension theory.
- Stay concise and visual where possible.

## Out of scope
- Firefox/WebExtensions differences unless they become necessary later.
- Manifest V2 history and migration details.
- General web-security topics not directly needed for the LODVault lookup path.
