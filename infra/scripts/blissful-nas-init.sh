#!/usr/bin/env bash
set -euo pipefail

NAS_ROOT="${BLISSFUL_NAS_ROOT:-/Volumes/2TB/NAS/blissful}"

echo "Creating Blissful NAS directory tree under: $NAS_ROOT"

dirs=(
  "$NAS_ROOT/config"
  "$NAS_ROOT/state/blissful-storage"
  "$NAS_ROOT/cache/meta"
  "$NAS_ROOT/cache/posters"
  "$NAS_ROOT/cache/addon"
  "$NAS_ROOT/cache/stream-gateway/hls"
  "$NAS_ROOT/cache/stream-gateway/temp"
  "$NAS_ROOT/logs/blissful"
  "$NAS_ROOT/logs/blissful-storage"
  "$NAS_ROOT/logs/addon-proxy"
  "$NAS_ROOT/logs/stream-gateway"
  "$NAS_ROOT/logs/ops"
  "$NAS_ROOT/backups/state"
  "$NAS_ROOT/backups/config"
)

for d in "${dirs[@]}"; do
  mkdir -p "$d"
  echo "  created: $d"
done

echo ""
echo "NAS directory tree ready."
echo "Next: copy existing state data:"
echo "  cp -a apps/shared/blissful-storage/data/* $NAS_ROOT/state/blissful-storage/"
