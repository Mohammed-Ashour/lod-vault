Trimmed real responses from `GET https://lod.lu/api/lb/entry/<ID>` (fetched 2026-11).
Only `entry` is kept; infoboxes and videos are dropped and each sense keeps at most
three examples (preferring ones with `gloss`/`attribute` parts). Everything else is
as LOD returned it, so parser tests run against real shapes.
