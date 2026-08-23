#!/bin/bash
# Hook script for Claude Code PostToolUse event.
# Transitions the terminal's status badge from blocked (waiting on a
# permission request) back to running once the tool call completes.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/build-payload.sh"
source "$SCRIPT_DIR/report-status.sh"

INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)

# TodoWrite rewrites the whole plan, so the report carries the whole plan — ThinkRail renders it under
# the terminal. Any other tool says nothing about todos and the last reported plan stands.
if [ "$TOOL_NAME" = "TodoWrite" ]; then
	TODOS=$(echo "$INPUT" | jq -c '[.tool_input.todos[]? | {content, status} + (if .activeForm then {activeForm} else {} end)]' 2>/dev/null)
	BODY=$(build_payload "$INPUT" "tool_complete" \
		--arg tool_name "$TOOL_NAME" \
		--argjson todos "${TODOS:-[]}")
else
	BODY=$(build_payload "$INPUT" "tool_complete" \
		--arg tool_name "$TOOL_NAME")
fi
report_status "$BODY"
