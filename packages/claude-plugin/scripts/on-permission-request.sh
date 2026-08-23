#!/bin/bash
# Hook script for Claude Code PermissionRequest event.
# Marks the terminal's status badge blocked and asks ThinkRail to raise a
# desktop notification: Claude wants to run a tool.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/build-payload.sh"
source "$SCRIPT_DIR/report-status.sh"

INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "unknown"' 2>/dev/null)
TOOL_PREVIEW=$(echo "$INPUT" | jq -r '(.tool_input | if .command then .command elif .file_path then .file_path else (tostring | .[0:80]) end) // ""' 2>/dev/null)
SUMMARY="Wants to run $TOOL_NAME"
if [ -n "$TOOL_PREVIEW" ]; then
	if [ ${#TOOL_PREVIEW} -gt 120 ]; then
		TOOL_PREVIEW="${TOOL_PREVIEW:0:117}..."
	fi
	SUMMARY="$SUMMARY: $TOOL_PREVIEW"
fi

BODY=$(build_payload "$INPUT" "permission_request" \
	--arg summary "$SUMMARY" \
	--arg tool_name "$TOOL_NAME")
report_status "$BODY"
