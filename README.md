# ThinkRail — CommanderTvis fork

A fork of [JetBrains/thinkrail](https://github.com/JetBrains/thinkrail). Upstream is a desktop-and-mobile
client for the [`pi`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) coding agent. This
fork turns it into a workbench for more than one agent: Claude Code runs in its terminals as a first-class
agent, with its own configuration pane, IDE bridge, hooks, launcher and the workspace's spec tools reachable
over MCP.

A Codex plugin adds a second terminal agent integration, and a plugin API lets
further integrations live outside core. The fork also carries a stream of fixes and features that are
sent upstream one commit at a time.

<img src="assets/screenshots/workbench.png" alt="ThinkRail workbench with Claude Code running in the terminal" width="900">

The workbench combines project and worktree navigation on the left, an embedded Claude Code terminal session in the center, and the workspace file tree alongside the Claude Code side panel on the right.

## Install

Nightly builds of the fork ship through the
[`CommanderTvis/homebrew-thinkrail`](https://github.com/CommanderTvis/homebrew-thinkrail) tap:

```bash
brew trust --tap commandertvis/thinkrail   # Homebrew 7+ refuses untrusted taps
brew tap commandertvis/thinkrail
brew install --cask thinkrail-desktop   # the Electrobun desktop app (ThinkRail-canary.app)
brew install thinkrail                  # or: the CLI host, `thinkrail` opens the browser client
```

The builds are unsigned and not notarized; the cask strips the quarantine flag after install so Gatekeeper
does not report the app as damaged. To run from source instead, see below.

On Windows, nightlies ship through the
[`CommanderTvis/winget-thinkrail`](https://github.com/CommanderTvis/winget-thinkrail) WinGet source
(CLI for x64 and ARM64, desktop for x64 on Windows 11 or later); its README has the install commands.
These builds are unsigned and have not been tested on a real Windows machine.

## What the fork has that upstream does not

**A plugin API.** `packages/plugin-api` is the contract: a manifest, typed methods, channels and settings, a
pi-free tool definition for the agent and MCP surfaces, and host and web contexts. The server loads builtin
and external plugins, validates their wire traffic, serves their assets and feeds their pi resources into
every session; the web client loads a plugin's UI half, at build time for builtins or over the wire for an
external one. `packages/plugin-ui` is the shared UI kit plugins draw with. External plugins live under
`~/.thinkrail/plugins/<id>/` or at the paths `AppConfig.pluginPaths` lists, and are enabled and disabled
while the app runs. A plugin defines a tool once and both a `pi` chat and a terminal agent (over MCP) can
call it. Plugins add side tools, launchers, tab decorations, file viewers, file icons, settings sections
and terminal accessories. See [`packages/plugin-api/SPEC.md`](packages/plugin-api/SPEC.md) and
[`packages/server/src/plugins/SPEC.md`](packages/server/src/plugins/SPEC.md).

**Nine builtin plugins**, each one commit, each extractable to its own repository. Claude Code and Codex
integrate terminal agents; the others add specification tools, viewers or presence:

| Plugin | What it adds |
| --- | --- |
| [`plugin-spec-dialect`](packages/plugin-spec-dialect) | the spec-graph read, the Specs side tool and the `spec_*` tool renderers |
| [`plugin-blueprint`](packages/plugin-blueprint) | the Blueprint interactive-spec format, its author and reactor |
| [`plugin-claude-code`](packages/plugin-claude-code) | Claude Code as the terminal agent: config pane, IDE bridge, hook status, launcher, terminal facts and picker driving, the shipped Claude marketplace |
| [`plugin-codex`](packages/plugin-codex) | OpenAI Codex as a terminal agent: config pane, launcher, hook status, `/ide` editor context and ThinkRail MCP tools |
| [`plugin-discord`](packages/plugin-discord) | Discord Rich Presence over local IPC |
| [`plugin-pdf-preview`](packages/plugin-pdf-preview) | a PDF file viewer |
| [`plugin-branch-graph`](packages/plugin-branch-graph) | the project's Git Graph side tool |
| [`plugin-visualize`](packages/plugin-visualize) | the terminal agent's live drawing surface, surfaced as an MCP tool |
| [`plugin-file-icons`](packages/plugin-file-icons) | material-icon-theme file-type glyphs |

<img src="assets/screenshots/git-graph.png" alt="Git Graph side tool" width="400">

The Git Graph side tool draws the project's branches and commits beside the terminal.

### Claude Code

The Claude Code plugin bridges terminal agent sessions to ThinkRail's workspace and UI.

- The terminal bar drives Claude Code's interactive `/model` picker and effort slider, and its Attach File button inserts workspace-relative `@file` paths.
- An IDE bridge feeds terminal events and facts into the app; hook status badges each tab, and resume works after a terminal is revived.
- The plugin ships its own Claude marketplace with a hook plugin, and keeps Claude's cached copy at the shipped version through Claude's own install and update commands.
- An agent that Claude Code starts, such as Codex, never takes over the tab.

<table>
<tr>
<td><img src="assets/screenshots/claude-code-context.png" alt="Claude Code persistent context tab" width="400"></td>
<td><img src="assets/screenshots/claude-code-account.png" alt="Claude Code account tab with usage limits" width="400"></td>
</tr>
<tr>
<td><img src="assets/screenshots/claude-code-scope-menu.png" alt="Moving a Claude Code plugin between scopes" width="400"></td>
<td><img src="assets/screenshots/claude-code-setting-edit.png" alt="Editing a Claude Code setting" width="400"></td>
</tr>
<tr>
<td colspan="2" align="center"><img src="assets/screenshots/claude-code-setting-scope.png" alt="Choosing where a Claude Code setting change is written" width="500"></td>
</tr>
</table>

The Context tab displays active instructions across global `~/.claude/CLAUDE.md`, project `CLAUDE.md`, referenced `AGENTS.md` files and launch flags, with live size accounting. The Account tab shows session and weekly usage limits and the CLI version. The Capabilities tab lists installed plugins, skills, hooks and ThinkRail's loopback MCP server, and moves any capability between User, Project and Local scope. Settings are edited in place, and each change asks which settings file it goes to and shows the diff before it is written.

### Codex

The Codex plugin runs the Codex CLI in a terminal the way Claude Code runs.

- A right-click launcher offers continue, resume or fork, sandbox choice, reasoning effort and web search.- Tab status comes from Codex's own lifecycle hooks, installed once into `~/.codex/hooks.json` and inert outside a ThinkRail terminal.
- The model chip switches a running session's model for that session only, never saving a new default.
- An IDE bridge speaks Codex's `ide-context` protocol, so `/ide` sees the open files, the active file and the selection without the VS Code extension.
- The config pane resolves project, user and system `config.toml` with provenance, shows the `AGENTS.md` chain, and edits values in place by TOML type, each key linking to Codex's configuration reference.

<table>
<tr>
<td><img src="assets/screenshots/codex-settings.png" alt="Codex settings pane" width="400"></td>
<td><img src="assets/screenshots/codex-account.png" alt="Codex account tab with plan and usage" width="400"></td>
</tr>
</table>

Configuration discovery covers the user, system and worktree-root files; profiles and nested project
configuration are not modelled. See [`packages/plugin-codex/SPEC.md`](packages/plugin-codex/SPEC.md) for
the current scope and limitations.

### Blueprint, spec dialect and the rest

<img src="assets/screenshots/blueprint.png" alt="Blueprint viewer beside the Claude Code terminal that wrote it" width="900">

- Blueprint pairs agent authoring with an interactive spec viewer for terminal agents and `pi` chats. The agent writes `BLUEPRINT.md` and verifies it with the `blueprint_check` MCP tool; the viewer renders decision cards, option selectors and rationale blocks live. It builds on the spec dialect, which owns the Specs panel and the `spec_*` tools for every session and sub-agent.
- The terminal visualization plugin gives the agent a `visualize` tool: it draws, publishes, then waits for your verdict. Drawings persist per terminal.
- The Git Graph draws commit lanes, is hidden in a folder with no history, and scopes the Changes panel when you click a commit.
- The PDF viewer uses `pdf.js` with zoom gestures, a text layer and a find bar.
- Discord Rich Presence is off by default, with a blocklist of projects and a switch for showing file names.
- File icons use recoloured material-icon-theme glyphs, with a fallback when the plugin is off.

### Improvements that apply to upstream directly

Kept as atomic commits so each can become a pull request:

- Projects and files: open a plain folder as a project without git, clone a repository URL into a project,
  search the whole workspace from one popup, create, rename, drag and trash files in the tree, reveal a
  file in the file manager, and a notice when an open file is deleted on disk.
- Editing and previews: an outline column that drives preview and source, frontmatter as an
  Obsidian-style properties block, Cmd+F in every preview, zoomable inline diagrams, a code font of your
  choice with ligatures, and an editor selection sent into a pi chat.
- Workbench: vertical tabs under their workspace, a frame that belongs to its project, branch pickers
  that show every remote, and a desktop window that returns to its port with its tabs.
- Terminals and agents: the spec tools reachable by any terminal agent over MCP, a terminal that thaws
  after a lost drain event, a pty that no longer inherits a stale utmpx user, live reattach that restores
  full-screen input modes, and a default model, hidden models and JetBrains AI org switching in Settings.
## Clone and run

The fork is developed and tested on macOS only. Other platforms build, but nothing here has been run on
them.

Prerequisites: Bun 1.4, Node.js 22.19 or newer, `git` on PATH, and an authenticated `pi` provider. App
state lives under `~/.thinkrail`.

```bash
git clone git@github.com:CommanderTvis/thinkrail.git
cd thinkrail
bun install
bun run desktop:dev
```

`bun run desktop:dev` packages the Electrobun desktop app with the host inside it and opens it. This is the
normal way to use the fork. Alternative:

```bash
bun run dev # host + web client in the browser, with hot reload
```

## Updating

A Homebrew install updates with `brew upgrade thinkrail` / `brew upgrade --cask thinkrail-desktop`.

A checkout: the branch is force-pushed very often. A plain `git pull` will not fast-forward. Update by
taking the remote branch as it is:

```bash
git fetch origin
git reset --hard origin/claude-code-integration-plugin-api
bun install
bun run desktop:dev
```

## Analytics & Privacy

Unchanged from upstream: basic usage events (launches, chat creation, accepted message sends, provider
connections) are always on; additional setup, run-outcome, task, review, and PR statistics follow an optional
sharing preference, shown on in the first-run dialog and changeable later in **Settings → Privacy**.
`thinkrail --no-analytics` or `THINKRAIL_NO_ANALYTICS=1` suppresses additional events for that run only.
Upstream's README describes details.
