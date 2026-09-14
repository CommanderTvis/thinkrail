#!/bin/bash
# Hook script for Claude Code Stop event.
# Marks the terminal's status badge done and asks ThinkRail to raise a
# desktop notification: Claude finished its turn.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/build-payload.sh"
source "$SCRIPT_DIR/report-status.sh"

INPUT=$(cat)

# A continuation's Stop still ENDS a turn, so the badge must settle either way — returning early here is
# what left it spinning after an auto-mode run. Only the desktop notification is suppressed, since that
# is the part that would fire twice. See SPEC.md.
STOP_HOOK_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)
if [ "$STOP_HOOK_ACTIVE" = "true" ]; then
	BODY=$(build_payload "$INPUT" "stop" --argjson notify false)
	report_status "$BODY"
	exit 0
fi

# The Stop hook fires before the transcript is fully written.
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)
sleep 0.3
QUERY=""
RESPONSE=""
if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
	QUERY=$(jq -rs '
        [
            .[] | select(.type == "user") |
            if .message.content | type == "string" then .
            elif [.message.content[] | select(.type == "text")] | length > 0 then .
            else empty
            end
        ] | last |
        if .message.content | type == "array"
        then [.message.content[] | select(.type == "text") | .text] | join(" ")
        else .message.content // empty
        end
    ' "$TRANSCRIPT_PATH" 2>/dev/null)

	RESPONSE=$(jq -rs '
        [.[] | select(.type == "assistant" and .message.content)] | last |
        [.message.content[] | select(.type == "text") | .text] | join(" ")
    ' "$TRANSCRIPT_PATH" 2>/dev/null)

	if [ -n "$QUERY" ] && [ ${#QUERY} -gt 200 ]; then
		QUERY="${QUERY:0:197}..."
	fi
	if [ -n "$RESPONSE" ] && [ ${#RESPONSE} -gt 200 ]; then
		RESPONSE="${RESPONSE:0:197}..."
	fi
fi

BODY=$(build_payload "$INPUT" "stop" \
	--arg query "$QUERY" \
	--arg response "$RESPONSE")
report_status "$BODY"
