---
id: module-claude-plugin
type: module-design
status: draft
title: claude-plugin — Claude Code terminal integration
parent: architecture
references: [submodule-server-terminal, submodule-web-panels]
tags: [claude-code, terminal, notifications, v1]
---

## Responsibility

An installable Claude Code plugin (`hooks/hooks.json` + shell scripts, no TypeScript, no build step) that
turns Claude Code lifecycle events into a report POSTed to the ThinkRail host that owns the terminal it
is running in, driving a per-tab status badge, the model/effort chips, and desktop notifications — and
that hands the session ThinkRail's own MCP tools. It is a
standalone artifact users install into their own `~/.claude` config, not part of ThinkRail's runtime
build graph.

**`.mcp.json` dials the host's MCP server with the terminal's own token.** The one server entry is
`{"type": "http", "url": "${THINKRAIL_MCP_URL}"}`; Claude Code expands the variable from the session's
environment, which the ThinkRail terminal stamped with a per-tab token — so every session reaches the
host's `/mcp/<token>` route (server's mcp/SPEC.md) as exactly the terminal it runs in, and gets the
`spec_*` tools against that workspace's worktree. Outside a ThinkRail terminal the variable is unset,
nothing resolves, and Claude Code lists the server as failed in `/mcp` — inert rather than wrong, the
same posture as the status POST having no address.

**It used to write OSC 777 into the PTY instead, and that was a mistake worth recording.** The mechanism
came from `warpdotdev/claude-code-warp`: a hook per lifecycle event writing
`ESC ] 777 ; notify ; <target> ; <json> BEL`, which ThinkRail's own xterm decoded as status. But OSC 777
means "show a desktop notification", every terminal that implements it renders whatever arrives, and none
of them filter on the target string — so a plugin installed globally in `~/.claude` turned every hook
event in every other terminal into a toast with our raw JSON as its body. The only defence was the
emitter checking an env var, which is a convention, not a boundary: it silently did nothing for weeks
because installed copies were older than the guard. A POST has no such failure mode. Nothing renders it,
nothing else can see it, and outside a ThinkRail terminal there is simply no address to send it to.

## Protocol

- **Address:** `THINKRAIL_AGENT_STATUS_URL`, stamped into every PTY ThinkRail spawns
  (`packages/server/src/terminal`'s `ptyEnv`). It is a loopback URL carrying a token minted for that tab,
  so a report says which terminal it came from without the agent knowing anything about workspaces or
  tabs, and a process that was never handed the token cannot report as one. Absent variable, no report —
  which is what makes the plugin silent in every terminal that is not ours.
- **Compatibility that went with it:** ThinkRail used to read Warp's `warp://cli-agent` sequences too, so
  a user with Warp's plugin installed got status here for free. That is gone, and deliberately: the same
  property is what let our sequences leak into Warp.
- **Payload:** `{v, agent:"claude", event, session_id, cwd, project, model?, effort?, ...event-specific
  fields}` — `project` is `basename(cwd)`.
- **A model switch is reported the moment it happens.** `PostModelSwitch` fires for any cause — `/model`,
  the picker, an SDK call, an automatic fallback, a resume — and carries `to_model`, so the chip follows
  the switch instead of waiting for the next turn to write an assistant entry the transcript can be read
  from. The event says nothing about what the session is *doing*, which is why it is the first report that
  carries facts without a status (`contracts/agentStatus.ts`); a caller's own `--arg model` wins over the
  transcript's for the same reason.
- **`model` comes from the hook input when it names one, the transcript otherwise; `effort` from the
  hook input.** `SessionStart` hands the session's active model over directly — so the chip appears the
  moment the session opens, before any turn has run, and a resume that changed the model beats whatever
  the transcript's old turns say. Every other hook says nothing about the model, which Claude Code
  records on each assistant turn in the transcript instead. `build-payload.sh` therefore falls back to
  reading the **tail** of `transcript_path`
  and taking the last real assistant turn's `message.model` — the tail because a transcript grows without
  bound, and the *last* turn because the model can be switched mid-chat. Synthetic turns (`<synthetic>`)
  are skipped, since they carry no model of their own. Effort is not read there: the transcript records
  it only on turns that have already run, so a turn the user had just raised to high reported the
  previous turn's level for its whole duration — the chip read "medium effort" while the session was
  visibly thinking at high. Every hook input carries `effort.level` for the turn in hand instead (after
  any silent downgrade for the model), and that is what is reported. A hook handed no level — the
  session-lifecycle ones, and models with no effort at all — reports none, and the last level reported
  for that terminal stands.
- **Only fields with a value are sent.** `build_payload` drops an empty `model` or `effort` rather than
  wiring an empty string, so a missing fact reads as "unchanged" to the host instead of blanking a chip. No protocol-version negotiation: ThinkRail is the only consumer of its own target
  string, so `v` is always the plugin's current version (1), unlike Warp's `WARP_CLI_AGENT_PROTOCOL_VERSION`
  min-negotiation (that existed to route around specific broken Warp client builds, not a concern here).
- **The version string is what refreshes an installed copy.** Claude Code caches a marketplace plugin
  under its version (`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>`) and keeps running that
  copy until the version moves. A fix to a hook script therefore ships only with a version bump — which
  is not a formality here: the guard that was supposed to keep OSC 777 out of other terminals existed in
  the repo for weeks while every installed copy still emitted, because the version had not changed. Bump `plugin.json` and the marketplace entry together; the host's own registration records
  `thinkrailVersion` and rewrites itself when they differ.
- **Delivery:** `report-status.sh` — one bounded `curl` (`--max-time 2`), output discarded, failures
  swallowed. A hook must never hold up the agent, and a host that has gone away is not something the user
  needs to hear about from inside their own session. No `curl`, no report.

**`todos` relays the plan `TodoWrite` just wrote.** PostToolUse for that one tool carries
`tool_input.todos` — the whole list, since the tool's contract is a whole-plan rewrite — trimmed to
`{content, status, activeForm?}` per item. No other event mentions todos, so ThinkRail keeps the last
reported plan standing between rewrites, the same convention as `model`.

## Event -> status mapping

| Hook | Event | Status (apps/web) |
|---|---|---|
| SessionStart (startup\|resume) | `session_start` | idle |
| PostModelSwitch | `model_switch` | unchanged (facts only) |
| UserPromptSubmit | `prompt_submit` | running |
| PostToolUse | `tool_complete` | running |
| PermissionRequest | `permission_request` | blocked (+ notification) |
| Stop | `stop` | done (+ notification) |
| StopFailure | `stop_failure` | failed (+ notification) |

`UserPromptSubmit`/`PostToolUse` exist specifically to transition back out of `blocked`/`done` — without
them the badge would get stuck through an entire agent turn.

**An idle nudge is not a state change.** Claude Code raises a `Notification` (`idle_prompt`, "Claude is
waiting for your input") a minute after the user goes quiet, and this plugin used to hook it and report
`blocked`. Nothing about the session had changed: a settled tab turned itself from *done* into *needs
you* while its owner was away from the keyboard, which reads as "something went wrong" and is the one
badge move nobody can trace back to an action. The hook is gone rather than made silent — `stop` already
notified when the turn ended, and repeating it a minute later says nothing new. What genuinely needs the
user is `PermissionRequest`, which has its own hook.

**A continuation's Stop still settles the badge.** `on-stop.sh` used to `exit 0` outright when
`stop_hook_active` was true — a guard meant to stop a second desktop notification, which also swallowed
the only signal that ends the turn, so an auto-mode run left the tab spinning after it had visibly
finished. It now emits the same `stop` event carrying `notify: false`: status settles, and
`panels/claudeCodeNotify` skips the notification for that flag. Suppressing the notification and
suppressing the status are separate concerns and must stay that way.

**The badge is not solely the plugin's to clear.** Nothing here fires when the agent is `Ctrl-C`'d, dies,
or is replaced by another program, so `store.setWorkspaceTerminals` also clears a status when the host's
process sweep reports the agent *gone* — the present→absent transition only, since a status can legitimately
arrive before the first sweep has seen the process. That safety net does not cover an agent that is alive
but idle at its own prompt (pi after "Cooked for …"), which has no status protocol here at all.

## Boundary

- **Owns:** `.claude-plugin/plugin.json`, `hooks/hooks.json`, `scripts/*.sh`, `.mcp.json`, and the repo-root
  `.claude-plugin/marketplace.json` that makes this installable (`claude plugin marketplace add
  <this-repo>` then `claude plugin install thinkrail@thinkrail`).
- **Public surface:** the plugin artifact itself, plus the report protocol documented above (consumed by
  `apps/web/src/panels/claudeCodeSequence.ts`).
- **Allowed deps:** `bash`, `jq` — nothing from this monorepo's runtime graph.
- **Forbidden:** value-importing or depending on any other package here; this ships to a user's own
  `~/.claude` config, not into any ThinkRail build output.

## Validation

- `tests/test-hooks.sh` — `build_payload` field extraction/merging, `emit-terminal-sequence.sh` version
  gating, and a routing smoke test per hook script (wired as this package's `bun run test`).
