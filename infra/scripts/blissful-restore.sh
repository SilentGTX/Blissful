#!/usr/bin/env bash
# Restore a Blissful state or config snapshot.
# Usage: blissful-restore.sh <snapshot-path>
# Example: blissful-restore.sh /Volumes/2TB/NAS/blissful/backups/state/state-20260219-120000.tar.gz
set -euo pipefail

NAS_ROOT="${BLISSFUL_NAS_ROOT:-/Volumes/2TB/NAS/blissful}"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <snapshot-tar-gz>"
  echo ""
  echo "Available state snapshots:"
  ls -1t "$NAS_ROOT/backups/state/"*.tar.gz 2>/dev/null || echo "  (none)"
  echo ""
  echo "Available config snapshots:"
  ls -1t "$NAS_ROOT/backups/config/"*.tar.gz 2>/dev/null || echo "  (none)"
  exit 1
fi

SNAPSHOT="$1"

if [ ! -f "$SNAPSHOT" ]; then
  echo "ERROR: Snapshot not found: $SNAPSHOT" >&2
  exit 1
fi

BASENAME=$(basename "$SNAPSHOT")

if [[ "$BASENAME" == state-* ]]; then
  TARGET="$NAS_ROOT/state"
  echo "Restoring STATE snapshot: $SNAPSHOT"
  echo "Target: $TARGET/blissful-storage/"
  echo ""
  echo "This will stop blissful-storage, overwrite state data, and restart."
  read -p "Continue? [y/N] " confirm
  if [[ "$confirm" != [yY] ]]; then
    echo "Aborted."
    exit 0
  fi

  echo "Stopping blissful-storage..."
  docker compose -f docker-compose.blissful-mac.yml stop blissful-storage 2>/dev/null || true

  echo "Extracting snapshot..."
  tar xzf "$SNAPSHOT" -C "$TARGET"

  echo "Starting blissful-storage..."
  docker compose -f docker-compose.blissful-mac.yml up -d blissful-storage

  echo "State restored successfully."

elif [[ "$BASENAME" == config-* ]]; then
  TARGET="$NAS_ROOT"
  echo "Restoring CONFIG snapshot: $SNAPSHOT"
  echo "Target: $TARGET/config/"
  read -p "Continue? [y/N] " confirm
  if [[ "$confirm" != [yY] ]]; then
    echo "Aborted."
    exit 0
  fi

  echo "Extracting snapshot..."
  tar xzf "$SNAPSHOT" -C "$TARGET"
  echo "Config restored successfully."

else
  echo "ERROR: Unknown snapshot type. Expected filename starting with 'state-' or 'config-'." >&2
  exit 1
fi
