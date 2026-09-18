---
id: module-plugin-claude-code
type: module-design
status: active
title: plugin-claude-code — configuration pane, IDE bridge, and terminal status for Claude Code
parent: module-plugin-api
depends-on: [module-plugin-api, module-contracts, module-shared, module-plugin-ui]
references: [module-server, module-web, submodule-server-terminal, submodule-server-mcp]
tags: [v1, plugins, claude-code]
---

## Responsibility

The Claude Code integration, external in spirit and builtin in this repository for now
(`plugin-adoption.md`, "Claude Code integration, external"). Resolves and edits Claude Code's own
configuration with provenance; bridges Claude Code's IDE protocol to ThinkRail's editors; carries the
per-terminal status report its own hook plugin posts; and offers an agent launcher, tab decorations, and
terminal chips on the web side. Moved out of core as part of the plugin-api adoption. Before this
move, `packages/server/src/claudeConfig/SPEC.md`, `packages/server/src/ideBridge/SPEC.md`, and
`packages/claude-plugin/SPEC.md` documented these three pieces separately; their content folds in here,
condensed, with the decisions and the OSC-777 post-mortem kept verbatim in spirit.

## What moved unchanged, and what didn't

`host/claudeConfig/*` (paths, merge, resolver, edits, diff, json, marketplace, uninstall, mcpList,
account, settingsDocs, plugin) and `host/ideBridge/*` (the WebSocket+MCP server, lock file, JSON-RPC
framing) moved as complete directories, their internal shape untouched — only their imports changed:
`../fs` → `@thinkrail/shared/textFile`, `../subprocess` → `@thinkrail/shared/runBounded`,
`@thinkrail/contracts`'s Claude-specific types → this package's own `contracts.ts`. `host/agentWatch.ts`
and `host/processTree.ts` (the `ps` poll) moved verbatim except `DETECTED_AGENTS`, narrowed to `["claude"]`
— nothing else in the codebase consumed the poll's `"pi"` detection (confirmed by grep before the move),
so narrowing it loses no live behavior. `host/agentResume.ts` (Claude-CLI flag parsing for
`--resume`/`--continue`) moved verbatim. `assets/marketplace/claude-plugin/` is `packages/claude-plugin/` unchanged.

What changed: `terminal/agentStatus.ts`'s report half is now `host/statusReport.ts`, pure and
token-free — the token → terminal resolution happens in `host/index.ts`'s route handler against
`ctx.terminalForToken`, not against a directly-imported `terminalTokens.ts` a plugin may not reach. The
`/agent-status/<token>` HTTP route is now `ctx.route()`, mounted under `/plugin/claude-code/status/<token>`
rather than a `server.ts` `fetch()` branch; `THINKRAIL_AGENT_STATUS_URL` is stamped by `ctx.terminalEnv`
instead of a resident default contributor in `terminalManager.ts`. `terminal.rememberAgent` (a WS method
with no web caller, confirmed by grep) and `rememberAgentSession` are gone; the status route calls
`ctx.setAgentRecord` directly, which is what fires `agentChanged` for any observer (Blueprint's
`ctx.onTerminal` tap among them) exactly as the old function did. The fourteen `claudeConfig.*`/
`ideBridge.*` wire methods lost their `claudeConfig.`/`ideBridge.` prefix and gained typebox param
validation — the first anywhere in this surface, since every old handler did an unchecked `params as
SomeType` cast.

## Host-owned pi mint, not core's

`host/index.ts` runs its own `createAgentWatch` instance, sourced from `ctx.terminals()` rather than a
core-owned poll, and pokes it on `ctx.onTerminal`'s `"spawned"` event — replacing the old
`if (loadConfig().claudeCodeEnabled) agentWatch.poke()` gate in `terminalManager.ts`'s `attachTerminal`,
which no longer exists: the poll now runs only while this plugin is active, which is what "off means no
`ps` sweep at all" (`plugin-adoption.md`, S1) actually requires. Detection writes
`ctx.setAgentRecord(ref, { kind: "claude", command, sessionId? })`; clearing writes
`ctx.setAgentRecord(ref, null)`. Title adoption (`adoptedTitle`) and the inline-mouse-mode reset stay in
`terminalManager.ts`, keyed generically on "does this tab's agent record exist", so they fire for any
plugin's record and this module carries none of that logic itself.

## The status channel's snapshot is an array, not a map

`statusSnapshot({ workspaceId })` returns `ClaudeCodeStatusPush[]`, one row per tab this workspace has
ever reported on — not a `Record<tabKey, …>` map. The web loader's snapshot-then-stream hydration
(`apps/web/src/plugins/loader/context.ts`) fans an array snapshot result out as one push per element,
handed to the same handler a live push reaches; a map result would arrive as a single mistyped "push".
`web/index.ts` opens exactly one `ctx.subscribe("status", …)` for the whole client, not one per visible
workspace: the snapshot method needs a `workspaceId`, but a live push does not, and folding every push
through the one store (`useClaudeCodeStore`) keeps every consumer (the tab adornment, the terminal chip)
reading the same values. `host/statusStore.ts` is the ephemeral per-tab cache this reads from and the route handler writes to,
forgotten on `ctx.onTerminal`'s `"closed"` event — nothing here needs to survive a restart, since a
revived terminal's agent re-reports on its own. It is also forgotten on an `agentChanged` event that
clears the record (interrupted, crashed, or replaced), so a badge nobody will ever settle does not spin
forever; a client already showing the stale badge settles on the next real event.

## An interrupt fires no hook, so the host reads the transcript

Claude Code's `Stop` hook does not run when the user interrupts a turn (Escape / Ctrl+C), and no other hook
event fires for it either — the hooks reference says so outright, and the 2.1.x binary carries no such
event name. A tab that went `running` on `prompt_submit` therefore had nothing left to settle it, and its
spinner rolled until the next prompt. What Claude does do, the moment a turn is interrupted, is append a
`user` line to the session transcript (`~/.claude/projects/<cwd>/<session>.jsonl`) whose text is
`[Request interrupted by user]` (or `… for tool use]`), followed by bookkeeping lines
(`file-history-snapshot`) that are not turns. `host/interruptWatch.ts` polls the tail of that file once a
second, only while a tab is `running`, and reports `interrupted` → `idle` when the last `user`/`assistant`
line is that marker and its `timestamp` is not older than the report that started the watch (minus
`INTERRUPT_CLOCK_SLACK_MS`, since the hook's POST lands a little after the event it describes). The
timestamp guard is what keeps a previous turn's marker from settling a new turn whose first line Claude has
not written yet. The route tracks on every `running` push (refreshing the window), stops on any other
settling status, on `closed`, and on an `agentChanged` that clears the record; the transcript is located
lazily through `agentTranscriptPath` because Claude writes it only once the session has something to save.
The synthesized report carries `session_id`/`cwd`/`project` only, so the store keeps the model, effort and
plan it already had. Rejected: `Notification`'s `idle_prompt` matcher (fires 60 s after Claude goes idle,
and would also fire after a normal `stop`, wiping the `done` dot), and sniffing Escape on the PTY input
(the plugin API deliberately exposes no terminal input, and a lone `ESC` byte is not a reliable
interrupt signal).

## Token spending is read from the session's own transcripts (`host/transcriptUsage.ts`)

The transcript's location is the `transcript_path` Claude Code hands every hook, relayed verbatim by
`build-payload.sh` (hook plugin 0.3.0). Claude Code writes sessions under `$CLAUDE_CONFIG_DIR/projects`
when that is set, not `~/.claude/projects` (checked against 2.x: a run with the variable pointed elsewhere
wrote nothing under `~/.claude`), and only the hook sees the agent's own environment, so the host never
guesses the directory from its own. The interrupt watch uses the same path. A report from an older cached
hook copy carries no path and falls back to `agentTranscriptPath`'s `~/.claude/projects` search; so does
revive, which runs with no report at all and therefore still misses a custom config directory.

A report carrying a `session_id` makes the host locate the transcript and read it forward from where it last stopped — a byte offset per file, complete lines only, so a turn mid-write is
picked up on the next report. Claude Code writes one assistant line per content block, every line of one
message sharing `message.id` with a usage that grows while it streams, so usage is kept per message id,
last line wins, and the session total is the sum. Subagent runs are the session's spending too and live
beside it as `<session id>/subagents/agent-*.jsonl` (verified on disk), so those are summed in. The total
rides the status push as `usage` — the host's reading, never the hook's, so the hook plugin and its
cached copy did not change — and the web store keeps the last value until a newer read replaces it. The
accessory shows it through the kit's `TerminalUsageChip` (`↑in ↓out R cache-read W cache-write`, no cost:
a subscription session has no meaningful one). A resumed session that Claude Code copied into a new
transcript counts the copied turns again; that is what its transcript says it spent. Offsets are dropped
when the last terminal reporting a transcript closes, so a revived terminal recounts from the start.

## `ideAction` is addressed, not broadcast

The old `ideBridge.action` channel broadcast to every socket; `plugin-api` SPEC.md's H1/H2 section names
this exact case ("a bridge that reports per-client editor facts and has to answer the client that owns a
terminal") as the reason per-client addressing exists. `host/index.ts` remembers the calling client's key
from every `selectionChanged`/`documentClosed` call, keyed by workspace, and `setIdeBridgeDeps`'s
`dispatch` addresses the publish to that client — throwing "No ThinkRail client is connected" if none has
reported yet, matching the old dispatcher's failure text for the equivalent case. `web/ideActions.ts`'s
`closeTab` handler matches the editor by its path's basename rather than a display name — W12's generic
editor list carries no display name, only the same path text a tab renders. The IDE protocol always sends
absolute paths while `editors.open` takes worktree-relative ones, so `ideActions.ts`'s `relative` strips the
worktree prefix itself: a plain POSIX prefix match, without the drive-letter and case-insensitive handling
the app's own `projectRelativePath` has (a plugin web half cannot reach it) — add it if a Windows report
ever needs it.

## The marketplace contains the plugin, not the other way round

The old `pluginRoot()`/`marketplaceRoot()` pair assumed a fixed nesting depth
(`<repo>/packages/claude-plugin`, marketplace root two directories up) that broke the moment the plugin
gained one more level of nesting. Both functions now resolve under one root — `marketplaceRoot()` to a
self-contained `<root>/marketplace/` directory carrying its own `.claude-plugin/marketplace.json`, and
`pluginRoot()` to `<root>/marketplace/claude-plugin` **inside** it, the entry's `source` being
`./claude-plugin`. A sibling layout with `source: "../claude-plugin"` was tried first and is rejected by
Claude Code's marketplace validation (`source: Invalid input`): a directory marketplace's relative
sources must stay under the marketplace directory, so no copy was ever installable from it, and Claude
kept running whatever older copy its cache held. That root is `ctx.assetsDir`, handed down once at
activation via `setAssetsRoot()` (`claudeConfig/plugin.ts`) rather than derived from `import.meta.dir`:
dev resolves through `packages/server/src/plugins/piResources.ts`'s `devBuiltinAssetsDir()` (this
package's own `build-support.ts` `assets` dir, i.e. `packages/plugin-claude-code/assets`), and a compiled
binary/desktop resolves through the staged dir `apps/cli/scripts/build-binary.ts` /
`apps/desktop/preBuild.ts` embed under `plugins/claude-code/assets` — both reaching
`PluginHostContext.assetsDir` (`activation.ts`'s getter) the same way any other builtin plugin's assets
do. `setAssetsRoot(null)` on deactivation and a `null`-coalescing fallback to the package's own `assets/`
dir keep a caller outside a real activation (a test) working unchanged. No environment variable and no
desktop staging step is plugin-specific. The repository's own root `.claude-plugin/marketplace.json`
still exists, updated to the plugin's new source path and version, as the human-facing "add this
marketplace to your own clone" entry point — independent of what `installPlugin()` registers
automatically.

## Protocol history: the hook plugin (`assets/claude-plugin`)

An installable Claude Code plugin (hooks + shell scripts, no TypeScript, no build step) that turns Claude
Code lifecycle events into a report POSTed to the address this plugin's `ctx.terminalEnv` contributor
stamps into the terminal's environment (`THINKRAIL_AGENT_STATUS_URL`), and hands the session ThinkRail's
own MCP tools via `.mcp.json`'s `${THINKRAIL_MCP_URL}` (minted by the same per-terminal token, core-owned,
S2).

**It used to write OSC 777 into the PTY instead, and that was a mistake worth recording.** The mechanism
came from `warpdotdev/claude-code-warp`: a hook per lifecycle event writing
`ESC ] 777 ; notify ; <target> ; <json> BEL`, which ThinkRail's own xterm decoded as status. But OSC 777
means "show a desktop notification", every terminal that implements it renders whatever arrives, and none
of them filter on the target string — so a plugin installed globally in `~/.claude` turned every hook
event in every other terminal into a toast with our raw JSON as its body. The only defence was the emitter
checking an env var, which is a convention, not a boundary: it silently did nothing for weeks because
installed copies were older than the guard. A POST has no such failure mode. Nothing renders it, nothing
else can see it, and outside a ThinkRail terminal there is simply no address to send it to.

Event → status: `session_start`→idle, `prompt_submit`/`tool_complete`→running, `permission_request`→
blocked, `stop`→done, `stop_failure`→failed, `model_switch`→facts only (no status move — the chip follows
a mid-chat model switch without waiting for the next transcript turn); `interrupted`→idle is never sent by the
hook plugin — the host synthesizes it from the transcript (see above). `model` comes from the hook input
when it names one, the transcript's last real assistant turn otherwise; `effort` from the hook input only,
never the transcript (which only records it on turns already finished). `todos` relays `TodoWrite`'s
whole plan, trimmed to `{content, status, activeForm?}` per item; every other event leaves the last
reported plan standing. A continuation's `Stop` still settles the badge (`notify: false` suppresses only
the desktop notification, not the status). Claude Code runs a marketplace plugin from its own cache
(`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>`, listed in `plugins/installed_plugins.json`),
not from the marketplace directory, and nothing but its own `claude plugin install` / `claude plugin
update` moves that copy — bumping the version in the marketplace alone changes nothing, which is how the
OSC-777 copy kept running for weeks after the POST transport shipped and why every revive fell back to
`--continue` (no report ever carried a `session_id`). So `pluginStatus()` reports the **cached** version as
the installed one, and `installPlugin()` follows the settings rewrite with that CLI command
(`pluginRefreshCommand`: `install … --yes` when nothing is cached, `update` otherwise, user scope, bounded
by `runPluginCommand`). `pluginStatusMaintained()` runs it once per shipped version and activation for a
registration the user already approved, so a refusal is not retried on every poll; the chip's button
retries on demand. A fresh copy applies to the next `claude` start, which is what the chip says.

## External configuration files

The host registers its discovered configuration paths through `externalFiles`. Core editor reads, saves,
and restoration use `fs.readFile`/`fs.writeFile` without naming this plugin. The plugin's existing
`readFile`/`writeFile` methods retain the same allowlist for direct callers. Settings and capability
source links pass the origin's JSON `keyPath` through `editors.open`, revealing its declaration against
the editor's current contents. File-level sources without a key path open normally.

The project's root instructions are `CLAUDE.md`, or `AGENTS.md` when no root `CLAUDE.md` exists —
Claude Code reads `AGENTS.md` in that case, so the Context surface lists it and stops offering to
create a `CLAUDE.md` beside it (`claudeConfig/paths.ts`, pinned in `capabilities.test.ts`).

`ClaudeGlyph` (`web/ClaudeGlyph.tsx`) draws the real Claude brand mark from this plugin's own
`assets/claude.svg` (the manifest declares `assets: "assets"`) — material-icon-theme's `claude` icon,
recoloured to `currentColor` the same way the file-icons plugin's generator does (MIT). It is a factory,
`createClaudeGlyph(ctx)`, built once in `activate(ctx)` and passed the resolved `ctx.assetUrl("claude.svg")`
so the returned component only ever fetches the one URL; rendering goes through the kit's `SvgAsset`
(`@thinkrail/plugin-ui`), the same fetch-once-per-URL inline-SVG primitive the file-icons plugin uses.
The manifest names the same file as `asset:claude.svg`, so core's rail and plugin list draw it from this
plugin's assets too, with no Claude-specific case in core.

## The settings schema's own field must default around a bare `{ enabled: true }`

`packages/server/src/plugins/settings.ts`'s `validatePluginNamespaces` validates a patch's merged result
*before* filling in schema defaults — so a plugin whose namespace has never been written before, enabled
the ordinary way (Settings → Plugins' toggle sends `{ enabled: true }` alone, nothing else), fails
validation the moment its settings schema has a *required* field, default or not. `command` is declared
`Type.Optional(Type.String({ default: "claude" }))`, not bare `Type.String({ default: … })`, for exactly
this reason — matching the pattern `settings.test.ts` already documents for this validator. Every reader
(`host/index.ts`'s `commandOf`, both web `ctx.useSettings()` destructures) falls back to `"claude"` itself,
since `ctx.settings()` returns the raw stored namespace, never the schema-defaulted one, until *something*
has actually patched `command` in.

## `ctx.terminalAccessory`'s one slot per plugin, one component with two jobs

A plugin gets exactly one `ctx.terminalAccessory` registration (keyed by plugin id, like `sideTool` and
`settingsSection`), so the install-offer banner (`ClaudeCodeChip`) and the running-session accessory
(`ClaudeTerminalFacts`) are composed into one component in `web/index.ts` rather than two registrations.
`ClaudeTerminalFacts` renders the model/effort fact chips, the TodoWrite plan toggle, and the attach
button — all null unless this terminal's agent record is `"claude"` — plus the picker-driving overlay,
shown regardless of that check while a drive is in flight.

### The attach chip lost its in-app worktree browser

The original `TerminalAttachFile` component listed a live worktree directory (`fs.readDir`, filter, up,
per-entry rows) — a capability no `PluginWebContext` exposes today; only `ctx.pickFile()` (one native
host dialog) is generic across plugins. The migrated attach chip is one button that calls `ctx.pickFile()`
directly and types `@path` for whatever it returns, dropping the in-app filtered browser. `attachPath`'s
relativize-against-cwd logic is unchanged and still covered — it now lives in `@thinkrail/plugin-ui`'s
`TerminalFacts` with `cwdLabel`, the fact chip and the attach button, shared with the Codex plugin; what's gone is
being able to browse the worktree without leaving the terminal. `apps/web/src/panels/terminalCwd.ts` keeps
a separate, smaller copy of `attachPath` alone (no `cwdLabel`) — core's own drag-a-
file-into-any-terminal handler (`TerminalInstance.tsx`) needs the same "relativize against cwd" arithmetic
for a plain shell-quoted drop, independent of this plugin and its `@path` convention.

### Sealing the pane during a picker drive needs no new host capability

The old `driving` ref lived inside `TerminalInstance.tsx` itself, gating its own `onData` handler so a
concurrent keystroke never reached the pty mid-drive — a plugin's `terminalAccessory` cannot reach that
handler (`TerminalAccessoryApi` is `{write, bufferTail, setKeyEncoding}`, nothing about seizing input).
The migrated overlay instead grabs DOM focus onto itself the moment a drive starts, and reclaims it in its
own `onBlur` — so a keystroke aimed at the real terminal (even an explicit refocus, as the sealed-pane e2e
test drives directly) lands on the inert overlay instead of xterm's helper textarea, without a single
change to `plugin-api` or `TerminalInstance.tsx`.

## An agent inside another agent

A tab's agent is its outermost one. An agent another agent started — Codex run by Claude Code, or the
other way round — inherits the terminal's status URL and shows up in this plugin's process poll, and
either would otherwise overwrite the outer agent's record. So while the tab's record names another
kind, this plugin checks the process tree (`runsInsideAgent`: a process named after that record's kind
sits between the shell and this plugin's agent — record kinds are process names) and, when it does,
drops the hook report and skips the detection. A record whose agent is gone (the plugin that wrote it
disabled, or a stale record after a revive) does not match, so it is still replaced. The poll forgets a
tab whenever its record clears, so an agent it skipped is claimed on the next sweep.

## What ThinkRail starts, ThinkRail manages

The launcher's menu (`web/claudeLaunch.ts`'s `CLAUDE_LAUNCH_MENU`) carries **Teleport a session here…**
beside Continue and Resume: `--teleport` picks up a session started somewhere else, which is the same kind
of choice about *what this run is* as the other two, and belongs in the same group rather than in a
settings field.

Every session ThinkRail starts is prefixed with `CLAUDE_CODE_DISABLE_AGENT_VIEW=true` by default, because
parallel sessions are what this app's workspaces and terminals are for — a second view of them inside the
CLI is one manager too many. It is a **prefix on the command line, not a host-wide environment**: it
applies to what ThinkRail launched and to nothing a person types themselves, and it is visible in the
terminal rather than being an invisible difference between running Claude here and running it anywhere
else. The `disableAgentView` setting (a checkbox in this plugin's settings section) turns it off for
anyone who wants the CLI's own view back. `withLaunchEnv()` prefixes a launch with that variable **in the
syntax of the shell that will read it** — a POSIX prefix typed into `cmd` is a command not found, and the
Windows shell is already a setting (`host().config.terminalWindowsShell`), so the three forms are pinned
by unit test rather than assumed. `terminalCommand()` (this plugin's `AgentLauncher` implementation,
registered via `ctx.launcher`) applies it once, on the composed line, so every caller that reaches a
Claude Code launch through the launcher — the workspace toolbar's `ClaudeLauncher`, the New Workspace
dialog's generic launcher picker — gets the prefix from the same place rather than each re-deriving it.

Each detected Claude Code terminal has an IDE context chip. It sends Claude's `/ide on` or `/ide off`
command, changing only that session's transfer of ThinkRail editor context; it does not alter the
integration's configuration or any other terminal.

## Capability rows

Capability rows place the origin scope beside the source filename, separate from the actions menu.
Capabilities without a source file keep their scope beside the name.

## Local setting overrides

Editing a setting opens its value composer, then the review popup offers every writable destination:
user, project, or local. Rows have no separate override action. The host plan/apply operations preview
and write only the selected file; other scopes remain intact. Claude Code merges lists across scopes.
Pending previews are discarded when the edit or scope changes, so only the current destination's
plan can be applied.

## Boundary

- **Owns:** `manifest.ts`, `contracts.ts` (the Claude Code, IDE-bridge, and agent-status domain types,
  moved from `packages/contracts/src/{claudeConfig,ideBridge,agentStatus}.ts`, as typebox schemas plus
  `Static` projections), `host/` (claudeConfig, ideBridge, the `ps` poll, resume composition, the status
  route and store, the transcript interrupt watch and usage reader, activation), `web/` (the configuration pane, tab decorations, launcher, terminal
  accessory — `ClaudeTerminalFacts` (fact chips, plan, attach, picker drive) plus `ClaudeCodeChip` (the
  install offer) — editor-event bridge,), `build-support.ts`,
  `assets/marketplace/claude-plugin` (the installable hook plugin) inside `assets/marketplace` (its self-contained
  marketplace manifest).
- **Public surface:** `./manifest` (`manifest`, `CLAUDE_CODE_ID`), `./contracts` (`claudeCodeContract` and
  every domain type/schema), `./host` (default export, a `PluginHostModule`), `./web` (default export, a
  `PluginWebModule`), `./build-support` (`buildSupport`).
- **Allowed deps:** `@thinkrail/plugin-api` (+ `/host`, `/web`), `@thinkrail/contracts`,
  `@thinkrail/shared`, `@thinkrail/plugin-ui`, `typebox`, `zustand`, `react`, `@remixicon/react`,
  Node/Bun built-ins.
- **Forbidden:** `@thinkrail/server`, `apps/*`, another plugin's host half, the app's
  store/transport/panels/chat modules, `terminalTokens.ts`/`terminalManager.ts` directly (reached only
  through `PluginHostContext`).

## Tests

`host/*.test.ts` and `host/claudeConfig/*.test.ts`/`host/ideBridge/*.test.ts` moved with their modules.
`host/statusReport.test.ts` is new, pinning the pure parse (unreadable body, unknown event, a facts-only
event resolving to a null status). `host/interruptWatch.test.ts` pins the transcript probe (the marker behind
bookkeeping lines, the tool-use variant, an older marker refused, a resumed turn not interrupted, only the
tail read) and the poll (fires once, stops when nothing is tracked, locates the transcript lazily, the slack
window). `host/index.test.ts` builds a minimal fake `PluginHostContext` (as
`plugin-spec-dialect` and `plugin-blueprint` do) and pins: the status route resolving a token, updating
the agent record, and publishing; `statusSnapshot` answering one row per reporting tab;
`prompt_submit`/`stop` feeding `ctx.suggestWorkspaceName`; the revive hook offering a resume command only
for a `"claude"`-kind record; `terminalEnv` stamping the status URL under this plugin's own route; and a
settings-sourced command line reaching `pluginUninstallPlan` instead of core config.
`host/transcriptUsage.test.ts` pins the spending read (one message over several lines counted once at
its last usage, reads resuming across appended data with a half-written line held back, subagent
transcripts summed, a missing file spending nothing); `web/store.test.ts` pins that a push without
`usage` keeps the last one. `e2e/plugins/claude-code/claude-terminal-facts.spec.ts` drives it end to end
against a fixture transcript under the lane's `HOME`.
`attachPath`/`cwdLabel` are pinned by `@thinkrail/plugin-ui`'s `TerminalFacts.test.ts`.
`assets/marketplace/claude-plugin/tests/test-hooks.sh` (bash) is this package's `bun run test`'s second half, unchanged.

## Account presentation

The Account surface uses plugin-ui's shared account rows, usage windows, and reading timestamps,
matching the Codex pane. Percentages explicitly say used; Claude's own severity still selects the bar
color. The plugin keeps ownership of reading and refreshing the account and explaining missing data.

## History

Moved out of core as part of the plugin-api adoption (`plugin-adoption.md`, "Claude Code integration,
external"). Before this move, `packages/server/src/claudeConfig/SPEC.md`, `packages/server/src/ideBridge/
SPEC.md`, and `packages/claude-plugin/SPEC.md` documented the configuration pane, the IDE bridge, and the
hook plugin separately; their decisions and history are preserved above, condensed, except where the
plugin boundary itself forced a rewrite (token resolution, route mounting, addressed publish, marketplace
staging).
