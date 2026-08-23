#!/bin/bash
# Builds a structured JSON status payload for a ThinkRail status report.
#
# Usage: source this file, then call build_payload with event-specific fields.
#
# Example:
#   source "$(dirname "${BASH_SOURCE[0]}")/build-payload.sh"
#   BODY=$(build_payload "$INPUT" "stop" \
#       --arg query "$QUERY" \
#       --arg response "$RESPONSE")
#
# The function extracts common fields (session_id, cwd, project) from the
# hook's stdin JSON (passed as $1), then merges any extra jq args you pass.

PLUGIN_PROTOCOL_VERSION=1

# Most hook inputs say nothing about the model, so it comes from the last real assistant turn in the
# transcript — but SessionStart carries `model` directly, which is what lets the chip appear before a
# first turn has run. Only the tail is read; a session's transcript grows without bound.
TRANSCRIPT_TAIL_LINES=400

session_model() {
	local transcript="$1"
	[ -n "$transcript" ] && [ -f "$transcript" ] || return 0
	tail -n "$TRANSCRIPT_TAIL_LINES" "$transcript" 2>/dev/null |
		jq -r --slurp 'map(select(.type == "assistant" and .message.model != null and .message.model != "<synthetic>"))
			| last
			| if . == null then empty else .message.model end' 2>/dev/null
}

build_payload() {
	local input="$1"
	local event="$2"
	shift 2

	local session_id cwd project transcript model effort
	session_id=$(echo "$input" | jq -r '.session_id // empty' 2>/dev/null)
	cwd=$(echo "$input" | jq -r '.cwd // empty' 2>/dev/null)
	transcript=$(echo "$input" | jq -r '.transcript_path // empty' 2>/dev/null)
	effort=$(echo "$input" | jq -r '.effort.level // empty' 2>/dev/null)
	project=""
	if [ -n "$cwd" ]; then
		project=$(basename "$cwd")
	fi
	model=$(echo "$input" | jq -r '.model // empty' 2>/dev/null)
	if [ -z "$model" ]; then
		model=$(session_model "$transcript")
	fi

	# The caller's own `--arg model` wins over the transcript's: an event that knows which model the
	# session switched to is a better answer than the last turn that ran. See SPEC.md.
	jq -nc \
		--argjson v "$PLUGIN_PROTOCOL_VERSION" \
		--arg agent "claude" \
		--arg event "$event" \
		--arg session_id "$session_id" \
		--arg cwd "$cwd" \
		--arg project "$project" \
		--arg lastModel "$model" \
		--arg lastEffort "$effort" \
		"$@" \
		'($ARGS.named
			| del(.v, .agent, .event, .session_id, .cwd, .project, .lastModel, .lastEffort)) as $extra
			| {v:$v, agent:$agent, event:$event, session_id:$session_id, cwd:$cwd, project:$project}
				+ $extra
				+ {model: ($extra.model // $lastModel), effort: ($extra.effort // $lastEffort)}
				| del((.model, .effort) | select(. == ""))'
}
