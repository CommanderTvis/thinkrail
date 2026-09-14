#!/bin/bash
# Hook script for Claude Code SessionStart event (startup|resume).
# Marks the session idle in ThinkRail's terminal status badge.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v jq &>/dev/null; then
	cat <<'EOF'
{
  "systemMessage": "ThinkRail notifications require jq. Install it with your system package manager (e.g. brew install jq, apt install jq)."
}
EOF
	exit 0
fi

source "$SCRIPT_DIR/build-payload.sh"
source "$SCRIPT_DIR/report-status.sh"

INPUT=$(cat)

PLUGIN_VERSION=$(jq -r '.version // "unknown"' "$SCRIPT_DIR/../.claude-plugin/plugin.json" 2>/dev/null)

BODY=$(build_payload "$INPUT" "session_start" \
	--arg plugin_version "$PLUGIN_VERSION")
report_status "$BODY"
