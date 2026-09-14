#!/bin/bash
# Hook script for Claude Code StopFailure event.
# Marks the terminal's status badge failed and asks ThinkRail to raise a
# desktop notification: Claude's turn ended due to an API error.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/build-payload.sh"
source "$SCRIPT_DIR/report-status.sh"

INPUT=$(cat)

ERROR_TYPE=$(echo "$INPUT" | jq -r '.error // empty' 2>/dev/null)
ERROR_MESSAGE=$(echo "$INPUT" | jq -r '.last_assistant_message // empty' 2>/dev/null)

BODY=$(build_payload "$INPUT" "stop_failure" \
	--arg response "$ERROR_MESSAGE" \
	--arg error_type "$ERROR_TYPE")
report_status "$BODY"
