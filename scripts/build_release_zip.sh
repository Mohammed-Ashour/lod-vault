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
  scripts/background.js \
  scripts/content.js \
  scripts/flashcards.js \
  scripts/popup.js \
  scripts/preview.js \
  scripts/shared.js \
  "$STAGE_DIR/scripts/"

(
  cd "$STAGE_DIR"
  zip -qr "$OUT_ZIP_VERSIONED" .
)

cp "$OUT_ZIP_VERSIONED" "$OUT_ZIP_LATEST"

echo "Built release zip: $OUT_ZIP_VERSIONED"
echo "Updated latest zip: $OUT_ZIP_LATEST"
