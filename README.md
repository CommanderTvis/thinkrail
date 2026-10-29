# ThinkRail — CommanderTvis fork

<img src="assets/screenshots/terminal-workbench.png" alt="Claude Code running in the fork's terminal workbench, with projects and worktree workspaces in the left rail and IDE context and file attachment controls below the terminal" width="900">

A fork of [JetBrains/thinkrail](https://github.com/JetBrains/thinkrail). Upstream is a desktop-and-mobile
client for the [`pi`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) coding agent. This
fork makes it a workbench for more than one agent: Claude Code and Codex run in its terminals as
first-class agents, through a plugin API, with the workspace's spec tools reachable over MCP.

> [!NOTE]
> This is an unofficial fork, not affiliated with JetBrains. It is developed and tested on macOS, and it launches on Windows; Linux is untested.

> [!TIP]
> Check out [SharpRail](https://github.com/CommanderTvis/sharprail/), the native rewrite of this idea.

> [!NOTE]
> **Try it in your browser, with a catch.** The [ThinkRail Playground](#thinkrail-playground) at
> https://commandertvis.github.io/thinkrail/ runs the whole host inside a browser tab, nothing to
> install. But nothing is bundled to chat with: you bring your own provider API key, or use a JetBrains AI
> license, which takes an exotic sign-in. Claude Code, Codex and other plugins that need a host process do not run there.

## Highlights

<table>
<tr>
<td width="38%" valign="top">
<b>See what Claude Code starts with</b><br><br>
The Claude Code pane's Context tab lists the instructions, skills and tools a session starts with, with live size accounting. Settings are edited in place, and each change shows its diff and asks which settings file it goes to.<br><br>
<a href="#claude-code">Details →</a>
</td>
<td width="62%">
<img src="assets/screenshots/claude-code-context.png" alt="Claude Code persistent context tab" width="100%">
</td>
</tr>
<tr>
<td width="38%" valign="top">
<b>Codex works the same way</b><br><br>
A launcher with resume, fork, sandbox and effort choices, status badges from Codex's own hooks, and a configuration pane that shows where every value comes from.<br><br>
<a href="#codex">Details →</a>
</td>
<td width="62%">
<img src="assets/screenshots/codex-settings.png" alt="Codex settings pane" width="100%">
</td>
</tr>
<tr>
<td width="38%" valign="top">
<b>Specs you can click through</b><br><br>
Blueprint pairs agent authoring with an interactive spec viewer: decision cards, option selectors and rationale blocks, shown next to the terminal as the agent writes them.<br><br>
<a href="#blueprint-spec-dialect-and-the-rest">Details →</a>
</td>
<td width="62%">
<img src="assets/screenshots/blueprint.png" alt="Blueprint viewer beside the Claude Code terminal that wrote it" width="100%">
</td>
</tr>
<tr>
<td width="38%" valign="top">
<b>Git history next to the terminal</b><br><br>
The Git Graph side tool draws commit lanes, and a click on a commit scopes the Changes panel to it.<br><br>
<a href="#blueprint-spec-dialect-and-the-rest">Details →</a>
</td>
<td width="62%">
<img src="assets/screenshots/git-graph.png" alt="Git Graph side tool" width="100%">
</td>
</tr>
</table>

### Agents

- [Claude Code](https://code.claude.com/docs/en/overview) and [Codex](https://github.com/openai/codex) get launchers, resume and status in workspace terminals.

## Install

Nightly builds of this fork install as `thinkrail` (CLI) and a desktop app.

macOS (Apple Silicon), from [commandertvis/homebrew-thinkrail](https://github.com/CommanderTvis/homebrew-thinkrail):

```sh
brew trust --tap commandertvis/thinkrail   # Homebrew 7+ refuses untrusted taps
brew tap commandertvis/thinkrail
brew install commandertvis/thinkrail/thinkrail                  # CLI
brew install --cask commandertvis/thinkrail/thinkrail-desktop   # desktop app (ThinkRail-canary.app)
```

Windows, from [CommanderTvis/winget-thinkrail](https://github.com/CommanderTvis/winget-thinkrail) (the
CLI for x64 and ARM64, the desktop for x64 on Windows 11):

```powershell
winget source add --name thinkrail --arg https://winget-thinkrail.vercel.app --type Microsoft.Rest   # once, as administrator
winget install --id CommanderTvis.ThinkRail --exact --source thinkrail --scope user                  # CLI
winget install --id CommanderTvis.ThinkRail.Desktop --exact --source thinkrail --scope user --interactive   # desktop app
```

Update through Homebrew or WinGet rather than the CLI's built-in self-update; the desktop app also updates
itself from the fork's nightly feed. Each repository's README covers upgrading, uninstalling and the
other packages it carries.

### From source

Needs Bun 1.4.0.

```bash
git clone --branch claude-code-integration-plugin-api https://github.com/CommanderTvis/thinkrail.git
cd thinkrail
bun install
bun run dev            # host + web client in the browser
bun run desktop:dev    # or the desktop app
```

## ThinkRail Playground

Open **https://commandertvis.github.io/thinkrail/** and click **Open the ThinkRail Playground** on the host
screen (the connection status in the top bar). ThinkRail then runs entirely in your browser tab, with nothing to install.

- Projects are kept in your browser and survive a reload. Clone a repository by URL, edit files, commit, pull and push.
- Chat with an agent using your own API key under Settings → Providers, or with a JetBrains AI license (see below).
- Terminals run a simulated shell with `git`, `node`, `npm install`, `npx` and `tsc`.
- Plugins that need a process on your machine (Claude Code, Codex, Discord, Git Graph) stay off.

**JetBrains AI.** Needs the [Central CLI](https://www.jetbrains.com/help/central-cli/quickstart.html), `curl` and `jq`. Choose JetBrains AI under Settings → Providers; the dialog explains the rest.

To remove everything the Playground stored (projects, chats, settings, API keys), press **Delete all Playground data** on the host screen.

## Plugin API

Everything above is a plugin. A plugin can add side tools, launchers, file viewers, file icons, settings
sections and terminal accessories, and defines an agent tool once for both `pi` chats and terminal agents
(over MCP). Builtin plugins ship with the app; your own go in `~/.thinkrail/plugins/<id>/` and can be
switched on and off while the app runs. See [`packages/plugin-api/SPEC.md`](packages/plugin-api/SPEC.md).

## Builtin plugins

Eight builtin plugins, each kept in its own commit so it can be extracted to its own repository. Claude Code and Codex
integrate terminal agents; the others add specification tools, viewers or presence:

| Plugin | What it adds |
| --- | --- |
| [`plugin-spec-dialect`](packages/plugin-spec-dialect) | the spec-graph read, the Specs side tool and the `spec_*` tool renderers |
| [`plugin-blueprint`](packages/plugin-blueprint) | the Blueprint interactive-spec format, its author and reactor |
| [`plugin-claude-code`](packages/plugin-claude-code) | Claude Code as the terminal agent: config pane, IDE bridge, hook status, launcher, terminal facts and picker driving, the shipped Claude marketplace |
| [`plugin-codex`](packages/plugin-codex) | OpenAI Codex as a terminal agent: config pane, launcher, hook status, `/ide` editor context and ThinkRail MCP tools |
| [`plugin-discord`](packages/plugin-discord) | Discord Rich Presence over local IPC |
| [`plugin-branch-graph`](packages/plugin-branch-graph) | the project's Git Graph side tool |
| [`plugin-visualize`](packages/plugin-visualize) | the terminal agent's live drawing surface, surfaced as an MCP tool |
| [`plugin-file-icons`](packages/plugin-file-icons) | material-icon-theme file-type glyphs |

The Git Graph side tool draws the project's branches and commits beside the terminal.

### Claude Code

The Claude Code plugin bridges terminal agent sessions to ThinkRail's workspace and UI.

- The terminal bar drives Claude Code's interactive `/model` picker and effort slider, and its Attach File button inserts workspace-relative `@file` paths.
- An IDE bridge feeds terminal events and facts into the app; hook status badges each tab, and resume works after a terminal is revived.
- The plugin ships its own Claude marketplace with a hook plugin, and keeps Claude's cached copy at the shipped version through Claude's own install and update commands.
- An agent that Claude Code starts, such as Codex, never takes over the tab.

<table>
<tr>
<td colspan="2" align="center"><img src="assets/screenshots/claude-code-account.png" alt="Claude Code account tab with usage limits" width="400"></td>
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

- A right-click launcher offers continue, resume or fork, sandbox choice, reasoning effort and web search.
- Tab status comes from Codex's own lifecycle hooks, installed once into `~/.codex/hooks.json` and inert outside a ThinkRail terminal.
- The model chip switches a running session's model for that session only, never saving a new default.
- An IDE bridge speaks Codex's `ide-context` protocol, so `/ide` sees the open files, the active file and the selection without the VS Code extension.
- The config pane resolves project, user and system `config.toml` with provenance, shows the `AGENTS.md` chain, and edits values in place by TOML type, each key linking to Codex's configuration reference.

<table>
<tr>
<td colspan="2" align="center"><img src="assets/screenshots/codex-account.png" alt="Codex account tab with plan and usage" width="400"></td>
</tr>
</table>

Configuration discovery covers the user, system and worktree-root files; profiles and nested project
configuration are not modelled. See [`packages/plugin-codex/SPEC.md`](packages/plugin-codex/SPEC.md) for
the current scope and limitations.

### Blueprint, spec dialect and the rest

- Blueprint pairs agent authoring with an interactive spec viewer for terminal agents and `pi` chats. The agent writes `BLUEPRINT.md` and verifies it with the `blueprint_check` MCP tool; the viewer renders decision cards, option selectors and rationale blocks live. It builds on the spec dialect, which owns the Specs panel and the `spec_*` tools for every session and sub-agent.
- The terminal visualization plugin gives the agent a `visualize` tool: it draws, publishes, then waits for your verdict. Drawings persist per terminal.
- The Git Graph draws commit lanes, is hidden in a folder with no history, and scopes the Changes panel when you click a commit.
- Discord Rich Presence is off by default, with a blocklist of projects and a switch for showing file names.
- File icons use recoloured material-icon-theme glyphs, with a fallback when the plugin is off.

### Other improvements

Smaller changes to ThinkRail itself, each kept as its own commit so it can go upstream as a pull request:

- Files: open a plain folder without git, search the whole workspace from one popup, create, rename, drag and trash files in the tree, reveal a file in the file manager.
- Editing: an outline beside previews, frontmatter as a properties block, Cmd+F in every preview, a code font with ligatures, and an editor selection sent into a `pi` chat.
- Workbench: vertical tabs under their workspace, branch pickers that show every remote, and the desktop app reopening with the tabs you had open.
- Terminals: the spec tools for any terminal agent over MCP.

## Analytics & privacy

We don't collect anything: this fork's builds send no usage analytics, error reports or installation data.
