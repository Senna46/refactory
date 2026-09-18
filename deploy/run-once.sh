#!/bin/sh
# Runs one refactory cycle immediately, ignoring the Sunday-cycle skip.
# Use this after install (or to retry the same week). Does not change launchd.

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ ! -f "$PROJECT_ROOT/dist/main.js" ]; then
  echo "Error: dist/main.js not found. Run 'npm run build' first."
  exit 1
fi

cd "$PROJECT_ROOT"
exec node dist/main.js --force "$@"
