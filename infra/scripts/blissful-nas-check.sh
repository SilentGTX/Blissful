#!/usr/bin/env bash
# Verifies that the Blissful NAS mount is available and writable.
# Exit 0 = healthy, Exit 1 = unavailable.
# Used by Docker entrypoints and health checks.
set -euo pipefail

NAS_ROOT="${BLISSFUL_NAS_ROOT:-/Volumes/2TB/NAS/blissful}"
CHECK_FILE="$NAS_ROOT/.health-check"
WRITE_CHECK="${BLISSFUL_NAS_CHECK_WRITE:-1}"

if [ ! -d "$NAS_ROOT" ]; then
  echo "FAIL: NAS root missing: $NAS_ROOT" >&2
  exit 1
fi

if [ "$WRITE_CHECK" != "0" ] && [ "$WRITE_CHECK" != "false" ]; then
  if ! touch "$CHECK_FILE" 2>/dev/null; then
    echo "FAIL: NAS not writable: $NAS_ROOT" >&2
    exit 1
  fi

  rm -f "$CHECK_FILE" 2>/dev/null || true
fi
echo "OK: NAS mount healthy: $NAS_ROOT"
exit 0
