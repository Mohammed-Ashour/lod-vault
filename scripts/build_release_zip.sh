#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v zip >/dev/null 2>&1; then
  echo "error: 'zip' is required to build the release archive." >&2
  exit 1
fi

VERSION="$(node -pe "require('./manifest.json').version")"
OUT_DIR="$ROOT_DIR/dist"
STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/lodvault-release.XXXXXX")"
OUT_ZIP_VERSIONED="$OUT_DIR/lodvault-v${VERSION}.zip"
OUT_ZIP_LATEST="$OUT_DIR/lodvault.zip"
FIREFOX_OUT_ZIP_VERSIONED="$OUT_DIR/lodvault-firefox-v${VERSION}.zip"
FIREFOX_OUT_ZIP_LATEST="$OUT_DIR/lodvault-firefox.zip"

cleanup() {
  python3 - "$STAGE_DIR" <<'PY'
import shutil
import sys
shutil.rmtree(sys.argv[1], ignore_errors=True)
PY
}
trap cleanup EXIT

python3 - "$OUT_DIR" <<'PY'
import os
import shutil
import sys
out_dir = sys.argv[1]
shutil.rmtree(out_dir, ignore_errors=True)
os.makedirs(out_dir, exist_ok=True)
PY
mkdir -p "$STAGE_DIR/scripts"

cp manifest.json "$STAGE_DIR/"
cp -R icons pages styles "$STAGE_DIR/"
cp \
  scripts/background-bundle.js \
  scripts/compress.js \
  scripts/content.js \
  scripts/entry-presenter.js \
  scripts/flashcards.js \
  scripts/lens-lookup.js \
  scripts/lens-overlay-shell.js \
  scripts/lens-overlay-controller.js \
  scripts/lens-render.js \
  scripts/lens-runtime.js \
  scripts/lens-session.js \
  scripts/lens-sentence-mode.js \
  scripts/lod-article.js \
  scripts/note-autosave.js \
  scripts/page-banner.js \
  scripts/popup-app.js \
  scripts/popup-backup.js \
  scripts/popup-current.js \
  scripts/popup.js \
  scripts/popup-list.js \
  scripts/popup-study.js \
  scripts/popup-sync.js \
  scripts/preview.js \
  scripts/shared.js \
  scripts/selection-trigger.js \
  scripts/store-core.js \
  scripts/sync-coordinator.js \
  scripts/sync.js \
  "$STAGE_DIR/scripts/"

(
  cd "$STAGE_DIR"
  zip -qr "$OUT_ZIP_VERSIONED" .
)

cp "$OUT_ZIP_VERSIONED" "$OUT_ZIP_LATEST"

# Firefox artifact: Chrome rejects background.scripts in MV3, Firefox
# requires it — emit a Firefox-only manifest and rebuild the zip.
(
  cd "$STAGE_DIR"
  python3 - <<'PY'
import json
with open("manifest.json") as f:
    manifest = json.load(f)
manifest["background"] = {"scripts": ["scripts/background-bundle.js"]}
with open("manifest.json", "w") as f:
    json.dump(manifest, f, indent=2)
    f.write("\n")
PY
  zip -qr "$FIREFOX_OUT_ZIP_VERSIONED" .
)

cp "$FIREFOX_OUT_ZIP_VERSIONED" "$FIREFOX_OUT_ZIP_LATEST"

echo "Built release zip: $OUT_ZIP_VERSIONED"
echo "Updated latest zip: $OUT_ZIP_LATEST"
echo "Built Firefox zip: $FIREFOX_OUT_ZIP_VERSIONED"
echo "Updated latest Firefox zip: $FIREFOX_OUT_ZIP_LATEST"
