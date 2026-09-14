#!/bin/bash
# Tests for the ThinkRail Claude Code plugin hook scripts.
#
# Validates that each hook script produces correctly structured JSON payloads
# by piping mock Claude Code hook input into the scripts and reading what they
# POST to the host, with a fake `curl` standing in for the wire.

set -uo pipefail

# Every hook only speaks inside a ThinkRail terminal; the host stamps this on the PTY.
export THINKRAIL_TERMINAL=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)"
source "$SCRIPT_DIR/build-payload.sh"

# A hook reports by POSTing to the address ThinkRail stamped into the terminal, so the tests stand a
# fake `curl` in front of it and read what would have gone over the wire.
STUB_DIR=$(mktemp -d)
POSTED="$STUB_DIR/posted.json"
cat >"$STUB_DIR/curl" <<'CURL_EOF'
#!/bin/bash
body=""
while [ $# -gt 0 ]; do
	case "$1" in
		--data-binary) body="$2"; shift 2 ;;
		*) shift ;;
	esac
done
printf '%s' "$body" >"$POSTED_FILE"
CURL_EOF
chmod +x "$STUB_DIR/curl"
export POSTED_FILE="$POSTED"
export PATH="$STUB_DIR:$PATH"
export THINKRAIL_AGENT_STATUS_URL="http://127.0.0.1:1/agent-status/test-token"

HOOK_DIR="$SCRIPT_DIR"
run_hook() {
	local hook="$1"
	local input="$2"
	: >"$POSTED"
	bash "$HOOK_DIR/$hook" <<<"$input" >/dev/null 2>&1
	cat "$POSTED"
}

PASSED=0
FAILED=0

assert_eq() {
	local test_name="$1"
	local expected="$2"
	local actual="$3"
	if [ "$expected" = "$actual" ]; then
		echo "  ok $test_name"
		PASSED=$((PASSED + 1))
	else
		echo "  FAIL $test_name"
		echo "    expected: $expected"
		echo "    actual:   $actual"
		FAILED=$((FAILED + 1))
	fi
}

assert_json_field() {
	local test_name="$1"
	local json="$2"
	local field="$3"
	local expected="$4"
	local actual
	actual=$(echo "$json" | jq -r "$field" 2>/dev/null)
	assert_eq "$test_name" "$expected" "$actual"
}

echo "=== build-payload.sh ==="

PAYLOAD=$(build_payload '{"session_id":"sess-123","cwd":"/Users/alice/my-project"}' "stop")
assert_json_field "v is 1" "$PAYLOAD" ".v" "1"
assert_json_field "agent is claude" "$PAYLOAD" ".agent" "claude"
assert_json_field "event is stop" "$PAYLOAD" ".event" "stop"
assert_json_field "session_id extracted" "$PAYLOAD" ".session_id" "sess-123"
assert_json_field "cwd extracted" "$PAYLOAD" ".cwd" "/Users/alice/my-project"
assert_json_field "project is basename of cwd" "$PAYLOAD" ".project" "my-project"

PAYLOAD=$(build_payload '{}' "stop")
assert_json_field "empty session_id" "$PAYLOAD" ".session_id" ""
assert_json_field "empty cwd" "$PAYLOAD" ".cwd" ""
assert_json_field "empty project" "$PAYLOAD" ".project" ""

PAYLOAD=$(build_payload '{"session_id":"s1","cwd":"/tmp/proj"}' "permission_request" \
	--arg summary "Wants to run Bash: rm -rf /tmp" \
	--arg tool_name "Bash")
assert_json_field "event is permission_request" "$PAYLOAD" ".event" "permission_request"
assert_json_field "summary present" "$PAYLOAD" ".summary" "Wants to run Bash: rm -rf /tmp"
assert_json_field "tool_name present" "$PAYLOAD" ".tool_name" "Bash"

PAYLOAD=$(build_payload '{"session_id":"s1","cwd":"/tmp/proj"}' "stop" \
	--arg query 'what does "hello world" mean?' \
	--arg response 'It means greeting. Use: printf("hello")')
assert_json_field "quotes in query preserved" "$PAYLOAD" ".query" 'what does "hello world" mean?'
assert_json_field "parens in response preserved" "$PAYLOAD" ".response" 'It means greeting. Use: printf("hello")'

echo ""
echo "=== report-status.sh ==="

source "$SCRIPT_DIR/report-status.sh"

: >"$POSTED"
report_status '{"event":"stop"}'
assert_eq "a report reaches the address the terminal was given" '{"event":"stop"}' "$(cat "$POSTED")"

: >"$POSTED"
THINKRAIL_AGENT_STATUS_URL= report_status '{"event":"stop"}'
# Outside a ThinkRail terminal there is no address, and a report is simply not made — the whole reason
# this is a POST and not an escape sequence some other terminal would render.
assert_eq "no address, no report" "" "$(cat "$POSTED")"

: >"$POSTED"
report_status ""
assert_eq "an empty body is not posted" "" "$(cat "$POSTED")"

echo ""
echo "Session facts (model from the transcript, effort from the hook input)"
TRANSCRIPT=$(mktemp)
cat >"$TRANSCRIPT" <<'TRANSCRIPT_EOF'
{"type":"user","message":{"role":"user"}}
{"type":"assistant","effort":"medium","message":{"role":"assistant","model":"claude-opus-5"}}
{"type":"assistant","effort":"medium","message":{"role":"assistant","model":"claude-sonnet-5"}}
{"type":"assistant","message":{"role":"assistant","model":"<synthetic>"}}
TRANSCRIPT_EOF
PAYLOAD=$(build_payload "{\"session_id\":\"s1\",\"cwd\":\"/tmp/proj\",\"transcript_path\":\"$TRANSCRIPT\",\"effort\":{\"level\":\"high\"}}" "stop")
# The latest real turn wins, so a model switched mid-chat is what gets reported.
assert_json_field "model comes from the last real assistant turn" "$PAYLOAD" ".model" "claude-sonnet-5"
# Effort is the turn in hand, not the level the transcript's finished turns ran at.
assert_json_field "effort is the level the hook was handed" "$PAYLOAD" ".effort" "high"

PAYLOAD=$(build_payload "{\"session_id\":\"s1\",\"cwd\":\"/tmp/proj\",\"transcript_path\":\"$TRANSCRIPT\"}" "session_start")
assert_json_field "no effort in the hook input reports none" "$PAYLOAD" "(.effort // \"absent\")" "absent"

cat >"$TRANSCRIPT" <<'TRANSCRIPT_EOF'
{"type":"user","message":{"role":"user"}}
TRANSCRIPT_EOF
PAYLOAD=$(build_payload "{\"session_id\":\"s1\",\"cwd\":\"/tmp/proj\",\"transcript_path\":\"$TRANSCRIPT\"}" "session_start")
assert_json_field "a transcript with no assistant turn reports no model" "$PAYLOAD" "(.model // \"absent\")" "absent"

PAYLOAD=$(build_payload '{"session_id":"s1","cwd":"/tmp/proj","transcript_path":"/nowhere/at/all.jsonl"}' "session_start")
assert_json_field "a missing transcript is not an error" "$PAYLOAD" ".event" "session_start"

# SessionStart hands the model over before any turn has run; the chip should not wait for one.
PAYLOAD=$(build_payload '{"session_id":"s1","cwd":"/tmp/proj","model":"claude-opus-5[1m]"}' "session_start")
assert_json_field "the hook input's own model beats an empty transcript" "$PAYLOAD" ".model" "claude-opus-5[1m]"

cat >"$TRANSCRIPT" <<'TRANSCRIPT_EOF'
{"type":"assistant","message":{"role":"assistant","model":"claude-sonnet-5"}}
TRANSCRIPT_EOF
PAYLOAD=$(build_payload "{\"session_id\":\"s1\",\"cwd\":\"/tmp/proj\",\"transcript_path\":\"$TRANSCRIPT\",\"model\":\"claude-opus-5\"}" "session_start")
assert_json_field "and beats the transcript too — a resume can change the model" "$PAYLOAD" ".model" "claude-opus-5"
rm -f "$TRANSCRIPT"

OUTPUT=$(run_hook on-prompt-submit.sh '{"session_id":"s1","cwd":"/tmp/proj","prompt":"hi"}')
assert_json_field "prompt-submit event" "$OUTPUT" '(tostring | test("prompt_submit"))' "true"

OUTPUT=$(run_hook on-post-tool-use.sh '{"session_id":"s1","cwd":"/tmp/proj","tool_name":"Bash"}')
assert_json_field "post-tool-use event" "$OUTPUT" '(tostring | test("tool_complete"))' "true"
assert_json_field "an ordinary tool says nothing about todos" "$OUTPUT" '(tostring | test("todos") | not)' "true"

# TodoWrite rewrites the whole plan, so the whole plan rides the report.
OUTPUT=$(run_hook on-post-tool-use.sh '{"session_id":"s1","cwd":"/tmp/proj","tool_name":"TodoWrite","tool_input":{"todos":[{"content":"a","status":"completed","activeForm":"doing a"},{"content":"b","status":"in_progress"}]}}')
assert_json_field "TodoWrite relays every item" "$OUTPUT" '(tostring | fromjson | .todos | length)' "2"
assert_json_field "and keeps content, status, and activeForm" "$OUTPUT" '(tostring | fromjson | .todos[0] | tojson)' '{"content":"a","status":"completed","activeForm":"doing a"}'

OUTPUT=$(run_hook on-permission-request.sh '{"session_id":"s1","cwd":"/tmp/proj","tool_name":"Bash"}')
assert_json_field "permission-request event" "$OUTPUT" '(tostring | test("permission_request"))' "true"

OUTPUT=$(run_hook on-model-switch.sh '{"session_id":"s1","cwd":"/tmp/proj","to_model":"claude-opus-5","from_model":"claude-sonnet-5"}')
assert_json_field "a model switch reports the model it switched to" "$OUTPUT" ".model" "claude-opus-5"
assert_json_field "and says only that, so no badge moves" "$OUTPUT" ".event" "model_switch"

# A switch with nothing to report is not a report: the chip keeps what it had.
OUTPUT=$(run_hook on-model-switch.sh '{"session_id":"s1","cwd":"/tmp/proj"}')
assert_eq "a switch without a model posts nothing" "" "$OUTPUT"

OUTPUT=$(run_hook on-stop.sh '{"session_id":"s1","cwd":"/tmp/proj"}')
assert_json_field "stop event" "$OUTPUT" '(tostring | test("\"event\":\"stop\""))' "true"

# A continuation's Stop still ends the turn: the badge must settle, only the notification is suppressed.
OUTPUT=$(run_hook on-stop.sh '{"session_id":"s1","cwd":"/tmp/proj","stop_hook_active":true}')
assert_json_field "stop_hook_active still settles the badge" "$OUTPUT" '(tostring | test("\"event\":\"stop\""))' "true"
assert_json_field "stop_hook_active suppresses only the notification" "$OUTPUT" '(tostring | test("\"notify\":false"))' "true"

# The ordinary Stop must NOT carry the suppression flag, or nothing would ever notify.
OUTPUT=$(run_hook on-stop.sh '{"session_id":"s1","cwd":"/tmp/proj"}')
assert_json_field "an ordinary stop still notifies" "$OUTPUT" '(tostring | test("\"notify\":false") | not)' "true"

OUTPUT=$(run_hook on-stop-failure.sh '{"session_id":"s1","cwd":"/tmp/proj","error":"rate_limit"}')
assert_json_field "stop-failure event" "$OUTPUT" '(tostring | test("stop_failure"))' "true"

echo ""
echo "=== Results: $PASSED passed, $FAILED failed ==="

if [ "$FAILED" -gt 0 ]; then
	exit 1
fi
