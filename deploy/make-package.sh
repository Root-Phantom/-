#!/usr/bin/env bash
# Builds the frontend and creates an update package (ZIP) for the Windows server.
# The package never contains backend/.env, .venv, node_modules, logs or uploads.
#
#   ./deploy/make-package.sh            ->  dist-packages/PoldokhtarGIS-update-YYYYMMDD-HHMM.zip
#
# On the server:
#   Expand-Archive C:\Temp\PoldokhtarGIS-update-....zip C:\Temp\pol-update -Force
#   C:\Temp\pol-update\deploy\apply-update.ps1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/dist-packages"
NAME="PoldokhtarGIS-update-$(date +%Y%m%d-%H%M)"
STAGE="$(mktemp -d)/$NAME"

echo "==> Building frontend"
(cd "$ROOT/frontend" && { [ -d node_modules ] || npm ci --no-audit --no-fund; } && npm run build)

echo "==> Staging files"
mkdir -p "$STAGE"
rsync -a \
  --exclude '.git' --exclude '.DS_Store' --exclude '__pycache__' --exclude '*.pyc' \
  --exclude 'backend/.venv' --exclude 'backend/.env' --exclude 'backend/logs' --exclude 'backend/uploads' \
  --exclude 'frontend/node_modules' --exclude '*.tsbuildinfo' \
  --exclude 'deploy/tools' --exclude 'dist-packages' --exclude 'pol_final' --exclude '_review_snapshot.tgz' \
  "$ROOT/backend" "$ROOT/frontend" "$ROOT/deploy" "$ROOT/docs" "$ROOT/README.md" "$STAGE/"

mkdir -p "$OUT_DIR"
(cd "$STAGE" && zip -qrX "$OUT_DIR/$NAME.zip" .)
rm -rf "$(dirname "$STAGE")"
echo "==> Package: $OUT_DIR/$NAME.zip"
