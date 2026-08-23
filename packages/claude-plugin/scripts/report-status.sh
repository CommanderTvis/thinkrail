#!/bin/bash
# Reports an agent status payload to the ThinkRail host that owns this terminal.
#
# ThinkRail stamps THINKRAIL_AGENT_STATUS_URL into the environment of every PTY it spawns: a loopback
# address carrying a token minted for that tab. Outside a ThinkRail terminal the variable is absent and
# this is silent — which is the whole point. The previous transport was OSC 777, whose original meaning
# is "show a desktop notification", so every other terminal that implements it rendered our payload as
# one; nothing filters on a target string, and a plugin installed in ~/.claude is global. See ../SPEC.md.

report_status() {
	local body="$1"
	[ -n "$body" ] || return 0
	[ -n "${THINKRAIL_AGENT_STATUS_URL:-}" ] || return 0
	command -v curl >/dev/null 2>&1 || return 0
	# Bounded and quiet: a hook must never hold up the agent, and the host being gone is not an error
	# the user needs to hear about from inside their own session.
	curl --silent --show-error --output /dev/null --max-time 2 \
		--header "Content-Type: application/json" \
		--data-binary "$body" \
		"$THINKRAIL_AGENT_STATUS_URL" 2>/dev/null || true
}
