---
id: module-plugin-codex
type: module-design
status: draft
title: plugin-codex — configuration pane, launcher, and terminal status for OpenAI Codex
parent: module-plugin-api
depends-on: [module-plugin-api, module-contracts, module-plugin-ui]
references: [module-plugin-claude-code, submodule-server-terminal, submodule-server-mcp]
tags: [v1, plugins, codex]
---

## Responsibility

The Codex CLI as a terminal agent, shaped after `plugin-claude-code` where Codex offers the same
mechanism and smaller where it does not. It launches `codex` in a terminal, detects it in the process
table, badges its tab with the hook-reported status, offers a resume on revive, hands launched sessions
ThinkRail's MCP server, and shows Codex's resolved configuration with provenance.

## IDE context

`host/ideBridge` implements Codex's private, version-0 `ide-context` IPC protocol for `/ide`.
The missing connection was independent of MCP: handing Codex tools never registered an editor
context provider. The plugin now registers that provider and serves open files, the active file,
and the current selection without changing Codex configuration or requiring its VS Code extension.

The web half reads editor lists through the plugin API and retains selection events and the last
active file per workspace, so focusing the terminal preserves its editor context. Each IPC request
asks connected frontends for a fresh snapshot of
the requested workspace. Only frontends currently displaying that workspace answer; a focused
window wins over an unfocused window. No host-side editor snapshot survives a closed frontend.
Paths are relative to Codex's requested directory except explicitly opened external files. A CLI
launched in a worktree subdirectory uses the deepest matching workspace and rebased file paths;
similarly named sibling directories do not match. Positions are zero-based in
Codex and converted from ThinkRail's one-based editor events. Closing an editor drops its selection.
An empty editor list is valid context. Requests for other worktrees cannot receive this workspace's
context; missing frontends and plugin disposal resolve with an IPC error within Codex's deadline.

The bridge joins an existing Codex router or owns one at `$CODEX_HOME/ipc/ipc.sock` (the
`codex-ipc` named pipe on Windows). It supports Codex client discovery and forwarding so other ThinkRail hosts
and Codex clients can share the router. With the default Codex home, an existing legacy
`<tmpdir>/codex-ipc/ipc-<uid>.sock` is used when the primary socket is absent; an explicit
`CODEX_HOME` stays isolated from that machine-wide legacy router. The bridge reconnects after the
router exits, never replaces a live socket, and removes only an owned stale socket after a refused
connection. Unix directories must be
owned by the user and not writable by others; frames and requests are bounded. Disablement closes
the provider, owned listener, connections, and pending requests. Socket failures are logged without
preventing the rest of the Codex plugin from loading. The native protocol is private and may change.
The handshake is verified against Codex CLI 0.155.0 with `/ide on`; protocol fixtures cover sharing,
router loss, stale sockets, and malformed frames. Browser coverage pins live selection coordinates,
window/workspace isolation, reload, and plugin lifetime. That test controls the inactive page's focus
signal because Playwright otherwise forces every headless page to report focus; editor data and IPC
remain real.

`host/ideContext.ts` joins that transport to plugin request/reply channels; `web/ideContext.ts`
owns the editor projection. Neither imports Claude Code or core editor internals. The transport
submodule owns no editor state and depends only on Node built-ins.

## Configuration (`host/config.ts`)

Codex reads `config.toml` from, highest first: `-c` overrides, the project's `.codex/config.toml` (only
when the project is trusted), `$CODEX_HOME/config.toml` (default `~/.codex`), and
`/etc/codex/config.toml`. The pane flattens every table into dotted leaf keys (`features.hooks`, `projects."/p".trust_level`) —
the form the reference documents them in — and resolves each across the three files, winner plus
shadowed values; `mcp_servers.*` is listed by name instead, and `hooks.state` and `projects` (Codex's own
hook and folder trust bookkeeping) are left out — the pane states instead whether this project is
trusted, which is what decides whether the project layer applies. Profiles, cloud-managed defaults and the
root-to-cwd walk of nested project configs are not modelled — the worktree root is the only project
directory considered. Trust is read from the user file's `projects."<path>".trust_level`, matching the
worktree or any ancestor; Codex's own git-root resolution for a linked worktree may disagree.

Instructions follow Codex's AGENTS.md discovery: the first non-empty of `AGENTS.override.md` /
`AGENTS.md` in `$CODEX_HOME`, then in the worktree root with `project_doc_fallback_filenames` appended.
The pane offers to create whichever of project `AGENTS.md`, `AGENTS.override.md` and `~/.codex/AGENTS.md`
is missing, with a one-line starter because Codex skips an empty file; nothing existing is overwritten.
Worktree and global files open in editor tabs. The host registers the configuration layers and discovered
instructions with `externalFiles`, including a custom `CODEX_HOME`. Core reads, restores, reloads, and
saves these files through the shared filesystem methods with compare-and-swap conflict protection.
Previously, external paths went through Claude Code's allowlist, silently rejecting Codex config links.
Browser coverage opens and saves the user config with Claude Code disabled and rejects unrelated paths.

Editing takes a key path into the user or project file (`setValue`). The edit rewrites one
`key = value` line inside the matching `[table]` section (the root for a top-level key), inserts one at
the end of that section, or appends the section when it does not exist, so comments and
Codex's own bookkeeping (`hooks.state`, `projects`) survive byte for byte. The result is re-parsed and
refused unless exactly that key changed — a multi-line value is left for the user to edit by hand.
Values keep their TOML type: a string, number, boolean or list of strings is written back as the same
type, and anything else (inline tables, `approval_policy`'s granular form) is shown but left to the file.
Each row is `@thinkrail/plugin-ui`'s `ScopedSettingRow`, the same one the Claude Code pane renders: key,
scope chip, value, the actual file it came from, and shadowed values from lower layers struck through.
Clicking a value opens the shared `SettingValueDialog` (the Claude pane's popup), in choice mode for an
enum key; "Add a setting" picks from the reference's documented leaf keys only (no free text), sets the editor
from that key's declared type, and writes the new key to the user file.
The Codex dialog saves directly — there is no diff review step as in the Claude pane.

`configKeys.ts` is generated by hand from Codex's configuration reference
(`bun scripts/generate-config-keys.ts`, `--check` to compare), keeping only each key and the type the
reference gives it, never OpenAI's prose — the same split the Claude plugin's settings list makes. A
key links to its reference row through a text fragment (`#:~:text=<key>,-<type>`), because the rows
carry no anchors; a nested key links to its nearest documented ancestor. A type written as `a | b | c`
makes the key a picker, and the host refuses any other value. An undocumented key means "newer than
this list", never "invalid".

## Status is Codex's own hooks, installed once into `hooks.json`

Codex has lifecycle hooks with Claude-shaped stdin (`hook_event_name`, `session_id`, `model`, `prompt`,
`last_assistant_message`, …), run through a shell. `installHooks` appends one command per event to
`$CODEX_HOME/hooks.json`, keeping anything already there; the command POSTs its stdin verbatim to
`THINKRAIL_CODEX_STATUS_URL` and does nothing when that variable is unset, so outside a ThinkRail terminal
it is inert. The variable is stamped per terminal by `ctx.terminalEnv`, under this plugin's
`status/<token>` route; the host parses the payload, not the shell.

Event → status: `SessionStart`→idle, `UserPromptSubmit`/`PostToolUse`→running, `PermissionRequest`→
blocked, `Stop`→done, `Interrupt`→idle. Codex fires `Interrupt` itself, so no transcript watch is needed.

Rejected: passing the hooks as `-c hooks.<Event>=…` on the launch line. Codex runs a hook only once its
source is trusted, and an untrusted CLI-supplied hook is skipped silently (verified against codex-cli
0.154); a hook in `hooks.json` is trusted once through Codex's `/hooks` review and stays trusted because
the command text never changes. ThinkRail never writes the trust record itself — that review is the
user's, and the hash format is Codex-internal. The pane reads `hooks.state` in the user config and
warns while no entry names `hooks.json`.

Blocked status uses a warning-outline icon with an accessible
"Codex: Action required" label and hover text; the task title does not repeat the ASCII status prefix.
The component subscribes directly rather than computing status inside the
`tabDecoration` resolver: core re-runs resolvers only when host state changes, and a status push changes
none (the agent record's session id is set once). The manifest icon `openai` is one core's
`plugins/registry/icons.ts` maps to Remix's OpenAI mark.

## Launch line (`launch.ts`)

Shared by the web launcher and the host's revive prefill. `-c "mcp_servers.thinkrail.url=\"$THINKRAIL_MCP_URL\""`
is left for the shell to expand, since the MCP URL is minted per terminal by core; the `mcp` setting turns
it off, and Windows shells get no override. A launcher system prompt becomes
`-c developer_instructions=…`; a resume is `codex resume <id>` or `codex resume --last`.

## Session revival

Revival offers an editable command; it never submits it automatically. A hook-reported UUID is used
only when a nonempty rollout exists under `$CODEX_HOME/sessions` (default `~/.codex/sessions`),
including sessions originally opened in another directory. Missing, malformed, or unsaved ids fall
back to `resume --last`, retaining Codex's current-directory selection. Archived sessions are excluded.
Lookup failures do not prevent terminal attachment.

The host rebuilds the configured invocation, preserving quoted executable paths and supported CLI
option values while removing positional prompts, image attachments, previous `resume`/`fork` selectors,
and `--last`/`--all`/`--worktree`. It adds exactly one resume selector and refreshes ThinkRail's MCP URL
through the existing launch composer. Unsupported options, shell compound commands, and incomplete quoting yield
no offer rather than a damaged command. Hook ids never become unquoted shell input.
Process detection retains the configured command, because the native wrapper's process name does not
recover shell quoting or launcher-only options. Revival therefore restores configured options; per-launch
menu overrides are not persisted. Session ids are retained only from an existing Codex agent record.

## Account and usage

The Account surface reads identity and ChatGPT usage allowances through the plugin's `account`
method. `host/account.ts` owns one lazy, retained `codex app-server` stdio connection per activation;
`host/appServer.ts` owns initialization, request ids, framing, bounded requests, and process cleanup.
The configured launch command supplies its executable (including a quoted path), not interactive
arguments. The child inherits the host environment and uses the user's home as cwd, so this is a
global account read using `CODEX_HOME`, not a worktree-specific profile. No shell, thread, turn, login,
or model request is involved. There is no polling or persisted credential/usage cache.

Each read calls `account/read`, then `account/rateLimits/read` for a ChatGPT account. Concurrent reads
share one request sequence. The multi-bucket response takes precedence over the legacy single bucket;
windows retain Codex's used percentage, duration, and Unix-second reset time. The UI uses plugin-ui's
shared account rows and usage windows: labeled identity, percent used with a progress bar, relative reset
times, and the reading's age plus absolute timestamp, matching Claude Code. Missing windows are unavailable,
never zero usage. Signed-out and API-key accounts have explicit empty states. A rate-limit error preserves
the account identity and displays an error instead of stale allowances. Refresh repeats these reads.

Disabling the plugin or changing its command closes the connection and rejects pending reads. Exit,
malformed responses, and timeouts invalidate the child; the next read starts a fresh one. Startup and
each request have a 15-second bound. On POSIX, the child owns a process group so a CLI wrapper's
native child is also stopped: teardown sends SIGTERM and escalates to SIGKILL after one second.
Windows keeps the child non-detached and uses `taskkill /T /F` for tree cleanup.
Tests exercise the real stdio transport against a protocol fixture, including handshake ordering,
reuse, partial lines, failures, timeout, disposal, and restart, without a model or real account.

## Pane layout

The pane follows the Claude pane's shape: `ToggleSegment` surfaces (Context — the AGENTS.md chain and
the offers; Settings — the trust line and the layered keys; Capabilities — the status hooks and the
MCP servers; Account — identity and usage), a re-read button, and warnings (an unreadable or
ignored layer, untrusted hooks) as rows above whichever surface is shown.

Context uses the Claude pane's file layout: creation offers first, then a Persistent context header
with the summed byte size, followed by file rows with a document icon, filename and scope chip,
home-abbreviated full source path beneath, and right-aligned byte size. Global instructions display
the user scope label, matching Claude's personal instructions; the underlying Codex scope stays global.
Paths keep their existing editor targets (relative for worktree files). No imported-file tree is
invented for Codex's flat instruction chain.

## Terminal accessory

A detected Codex terminal also offers a non-modal subscription notice, automatically expanded on
first display. It explains that the user's ChatGPT subscription can be used in ThinkRail's Pi GUI
and directs them to Settings → Providers → OpenAI Codex, then an OpenAI Codex model in a Pi chat.
This is an invitation to a separate Pi session, not a conversion of the running Codex session or
automatic credential sharing. The context is the
[subscription follow-up](https://github.com/JetBrains/thinkrail/issues/437#issuecomment-5731635502).
The notice opens upward from the terminal's bottom-right accessory corner, aligned to that edge.
It uses plugin-ui's popover, preserves terminal focus, and can be dismissed with its button,
Escape, or an outside click. Dismissal lasts for that terminal during the plugin activation; its
accessory button can reopen it. “Never show again” persists `hideSubscriptionNotice` through the
plugin settings, hiding the notice and its trigger across terminals, workspaces, and reloads.
A failed save leaves the notice available and reports the error. Ordinary terminals have no notice.
Browser coverage pins detection, dismissal/reopening, preserved focus, and persistence after reload.

A Codex terminal's accessory row shows `@thinkrail/plugin-ui`'s attach button. The working directory
is already visible in Codex's TUI, so the accessory does not repeat it. Attach types the picked path,
relativized against the hook-reported `cwd`, without Claude's `@` prefix:
Codex's `@` opens its own fuzzy file search instead of taking a literal path.

## Launcher menu

Settings → Codex persists a default permissions mode in the plugin settings. It reuses the launcher's
sandbox, workspace-write-with-approval, and bypass presets; "Use Codex configuration" adds no flags
and remains the default. The setting applies to new launches, Start work, resume/fork, and revival.
The picker follows the shared settings menu pattern: an outline button with a dropdown arrow,
a left-aligned menu matching the trigger width, and radio options marking the saved selection.
A permission preset selected from the menu replaces the saved mode for that launch; model and search
presets retain it. This does not edit Codex's config.toml or change running sessions. Permission flags
embedded in a custom launch command remain the user's responsibility.

Left click starts `codex`; right click mirrors the Claude launcher's menu with Codex's own vocabulary
(`codexLaunchMenu`): continue the last session, resume or fork one through Codex's picker, then
sandbox modes (`-s`) from the reference's enum types, workspace write with approval on request
(`--sandbox workspace-write --ask-for-approval on-request`), bypassing approvals and
sandbox (`--yolo`), and live web search. A preset's subcommand goes first on the line and its flags after
the MCP override.

The workspace-write preset spells out the former `--full-auto` behavior because current interactive
Codex rejects that shorthand. Its sandbox and approval policy remain explicit in the launch regression
test; changing CLI vocabulary must not silently change permissions.

As in Claude Code, one curated `CODEX_MODELS` list supplies both the right-click model presets and
the registered launcher's Start work picker. The list follows the recommended models in the
[OpenAI Codex model documentation](https://learn.chatgpt.com/docs/models): GPT-6 Astra, GPT-5.6 Sol,
GPT-5.6 Terra, and GPT-5.6 Luna. Selecting a model adds `--model <id>` for that launch only;
left click and Start work's Default model omit an override, preserving Codex's configured default.
The picker is not an account-availability catalog, matching Claude's static aliases. Other model IDs
remain usable through the configured launch command. Start work resolves a held choice against the
selected launcher's own list, so switching from Claude to Codex cannot pass a Claude model alias.

## Detection

`host/agentWatch.ts` and `host/processTree.ts` are copies of `plugin-claude-code`'s, looking for
`codex` instead of `claude`: a plugin may not import another plugin's host half, and each builtin plugin
stays extractable on its own. The agent record's `command` is the configured launch command rather than
the captured process line, since the process is Codex's native binary under its npm/brew wrapper.

## Boundary

- **Owns:** `manifest.ts`, `contracts.ts`, `launch.ts`, `configKeys.ts` (generated) + `configDocs.ts`,
  `scripts/generate-config-keys.ts`, `host/` (config, status parse and store,
  process watch, account reader and app-server lifecycle, activation), `web/` (config pane, account surface,
  settings section, launcher, tab decoration, status store).
- **Public surface:** `./manifest` (`manifest`, `CODEX_ID`), `./contracts` (`codexContract` and its
  schemas), `./host` (default `PluginHostModule`), `./web` (default `PluginWebModule`),
  `./build-support` (`buildSupport`).
- **Allowed deps:** `@thinkrail/plugin-api` (+ `/host`, `/web`), `@thinkrail/contracts`,
  `@thinkrail/plugin-ui`, `typebox`, `zustand`, `react`, `@remixicon/react`, Node/Bun built-ins.
- **Forbidden:** `@thinkrail/server`, `apps/*`, another plugin, the app's store/transport/panels modules.

## Tests

`host/config.test.ts` pins the in-place TOML edit (replace, insert before a table, remove, a same-named
key inside a table untouched, a multi-line value refused), trust-gated layering with shadowing, AGENTS.md
override and empty-file handling, an idempotent `hooks.json` install that keeps the user's own hooks, and
the hook command posting its stdin only when the status URL is set. `host/status.test.ts` pins the
event→status mapping and the launch line's quoting.

`host/agentResume.test.ts` pins rollout lookup, missing/empty/archived session fallback, quoted
invocations, discarded prompts and images, replaced resume/fork selectors, repeated revival with a
fresh MCP override, and rejection of malformed commands. `host/index.test.ts` pins revive registration
and replacement of another agent's record by a Codex hook. No new persistence or API surface is needed:
core retains the agent record and the existing revive prefill owns the editable offer.
