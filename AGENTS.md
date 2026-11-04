# Agent instructions

## Exploring code with CodeGraph

This repo has a local CodeGraph index in `.codegraph/` (gitignored, per machine). Use it before grep or reading whole files when you need to find or understand code.

- MCP tool, when available: `codegraph_explore`. It returns the relevant symbols' current source and the call paths between them. To register the server, run `codegraph install --target claude --location local`.
- Shell, which always works:
  - `codegraph explore "<symbols or question>"` for source and call paths
  - `codegraph node <symbol-or-file>` for one symbol's source with its callers and callees
  - `codegraph callers <symbol>`, `codegraph callees <symbol>` and `codegraph impact <symbol>` before changing a function
  - `codegraph affected <files...>` to find tests affected by a change

If the index is missing, build it with `codegraph init -y`. If `codegraph status` shows it is stale, run `codegraph sync`.

Things to watch for in results:

- `scripts/background-bundle.js` is generated from `scripts/background-impl.js` and its imports, so symbols such as `normalizeEntry` appear twice. Edit the source file, then run `npm run build:background`.
- `.js` scripts are loaded as globals through `manifest.json` and `pages/*.html`, and tests load them through `tests/helpers/loaders.js`. The graph can miss these links, and it can report "no tests found" for code that is tested. Confirm with grep in `tests/` before relying on it.
- Only JavaScript and YAML are indexed. Check `pages/*.html` and `styles/*.css` directly.
