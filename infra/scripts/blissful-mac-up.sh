#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"

NAS_ROOT="${BLISSFUL_NAS_ROOT:-/Volumes/2TB/NAS/blissful}"
COMPOSE_FILE="${BLISSFUL_COMPOSE_FILE:-$REPO_ROOT/docker-compose.yml}"

if [ ! -d "$NAS_ROOT" ]; then
  echo "ERROR: NAS root missing: $NAS_ROOT" >&2
  exit 1
fi

if ! command -v dot_clean >/dev/null 2>&1; then
  echo "ERROR: dot_clean command not found" >&2
  exit 1
fi

echo "Cleaning AppleDouble metadata in Blissful NAS paths..."
dot_clean -m "$NAS_ROOT/state" || true
dot_clean -m "$NAS_ROOT/logs" || true

if [ "$#" -eq 0 ]; then
  echo "Starting Blissful Mac stack..."
  docker compose -f "$COMPOSE_FILE" up -d
else
  echo "Starting selected Blissful Mac services: $*"
  docker compose -f "$COMPOSE_FILE" up -d "$@"
fi

echo "Done."
