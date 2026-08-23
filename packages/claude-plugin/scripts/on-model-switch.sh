#!/bin/bash
# Hook script for Claude Code PostModelSwitch: the session changed model, whatever asked for it —
# /model, the picker, an SDK call, an automatic fallback, or a resume. Says so at once rather than
# leaving the chip on the last turn's model until the next one runs.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/build-payload.sh"
source "$SCRIPT_DIR/report-status.sh"

INPUT=$(cat)

TO_MODEL=$(echo "$INPUT" | jq -r '.to_model // empty' 2>/dev/null)
[ -z "$TO_MODEL" ] && exit 0

BODY=$(build_payload "$INPUT" "model_switch" \
	--arg model "$TO_MODEL")
report_status "$BODY"
