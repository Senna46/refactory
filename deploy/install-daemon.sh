#!/bin/sh
# Installs refactory as a user LaunchAgent that starts every Sunday at 00:00.
# Run from the project root: ./deploy/install-daemon.sh
# Requires: npm run build already done, .env configured.
# Does not run the first trial; use ./deploy/run-once.sh after install.

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PLIST_NAME="com.senna.refactory"
LAUNCH_AGENTS="${HOME}/Library/LaunchAgents"
PLIST_DEST="${LAUNCH_AGENTS}/${PLIST_NAME}.plist"
LOG_DIR="${HOME}/.refactory/logs"

if [ ! -f "$PROJECT_ROOT/dist/main.js" ]; then
  echo "Error: dist/main.js not found. Run 'npm run build' first."
  exit 1
fi

if [ ! -f "$PROJECT_ROOT/.env" ]; then
  echo "Warning: .env not found. Copy .env.example to .env and configure."
fi

NODE_BIN="$(which node)"
if [ -z "$NODE_BIN" ]; then
  echo "Error: node not found in PATH. Install Node.js first."
  exit 1
fi

mkdir -p "$LAUNCH_AGENTS"
mkdir -p "$LOG_DIR"

escape_sed() {
  printf '%s\n' "$1" | sed -e 's/[&\\/|]/\\&/g'
}
SAFE_PROJECT_ROOT="$(escape_sed "$PROJECT_ROOT")"
SAFE_HOME="$(escape_sed "$HOME")"
SAFE_NODE_BIN="$(escape_sed "$NODE_BIN")"

sed -e "s|__PROJECT_ROOT__|$SAFE_PROJECT_ROOT|g" -e "s|__HOME__|$SAFE_HOME|g" -e "s|__NODE_PATH__|$SAFE_NODE_BIN|g" \
  "$SCRIPT_DIR/refactory.plist" > "$PLIST_DEST"
chmod 644 "$PLIST_DEST"

launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load "$PLIST_DEST"
echo "refactory LaunchAgent installed (Sunday 00:00). Logs: $LOG_DIR/stdout.log and $LOG_DIR/stderr.log"
echo "First trial: ./deploy/run-once.sh"
echo "Status: launchctl list | grep refactory"
