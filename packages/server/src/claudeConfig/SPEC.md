---
id: submodule-server-claude-config
type: submodule-design
parent: module-server
status: draft
title: claudeConfig — resolving Claude Code's configuration
depends-on: [module-contracts]
tags: [v1, claude-code]
---

## Responsibility

Resolves the configuration Claude Code will actually apply for one workspace, reports **where each
effective value came from**, and writes changes back — every one of them scoped by the user and approved
as a diff first.

The problem this exists for: Claude Code spreads configuration across roughly six file kinds and five
scopes, and each concern resolves by a *different* rule. Nothing in the system reports which file won,
so "why is Claude doing this?" is answered by filesystem archaeology. Full analysis and the pane design
it serves: the Claude Code Control Pane artifact.

## Off by default

The whole surface is gated by `AppConfig.claudeCodeEnabled`, which starts **false**. This module reads
files outside the worktree, the terminal module polls the process table to find a running agent, and the
plugin offer writes to `~/.claude` — none of which a user who does not run Claude Code should acquire by
installing ThinkRail.

Enforced on **both** sides, because a hidden control is not a permission boundary: the host refuses every
`claudeConfig.*` request and `terminal.rememberAgent` while it is off, and the client hides the pane, the
terminal badge, the plugin chip and the agent status reports. With it off nothing under `~/.claude`
is opened and no `ps` sweep runs. A layout saved while it was on outlives the setting, so that tab
explains itself rather than rendering a pane the host would refuse anyway.

## Boundary

- **Owns:** the file inventory (`paths.ts`), the precedence/merge algebra (`merge.ts`), snapshot
  assembly (`resolver.ts`), the edits (`edits.ts` + `diff.ts`), and the plugin install (`plugin.ts`).
  `json.ts` holds the two shape predicates the rest of them share.
- **Public surface (barrel):** `resolveClaudeConfig(workspaceId, root)`, `planClaudeEdit` /
  `applyClaudeEdit`, `readClaudeConfigFile` / `writeClaudeConfigFile`, `pluginStatus()`,
  `installPlugin()`, `pluginUninstallCommand` / `uninstallClaudePlugin`, `pluginMoveCommands` /
  `moveClaudePlugin`, `marketplaceCommand` / `runMarketplaceAction`.
- **Allowed deps:** `node:fs` / `node:os` / `node:path`, `contracts` (types), `fs` (`contentHash` — one
  definition of the compare-and-swap hash for both this module's consented edits and the editor's writes;
  plus `readFileAt`/`writeFileAt` for the files the pane reports), `subprocess` (`runBounded`, for the one
  command this module runs — infrastructure that knows no feature, like `fs`).
- **Forbidden:** `host`; other sibling features.
- **Uninstalling is Claude's job, not ours** (`uninstall.ts`). Turning a plugin off is a settings key and
  belongs to the edit pipeline; *removing* one spans the settings key, Claude's own `installed_plugins.json`
  ledger and the downloaded files under `~/.claude/plugins/cache` — three places with undocumented,
  versioned formats. So the host runs `claude plugin uninstall <id> --scope <scope> --yes` through
  `runBounded` and lets Claude Code own its own bookkeeping. `--yes` answers the prune prompt that a
  non-TTY invocation must answer; the data directory goes with the plugin, as Claude's default does.
  Every plugin command runs with the workspace's worktree as cwd: `--scope project`/`local` writes the
  settings of the *current directory*, so the host's own cwd would silently retarget them.
- **Marketplaces are first-class rows, and their verbs are Claude's own subcommands**
  (`marketplace.ts`): the resolver reports each `extraKnownMarketplaces` entry as a `marketplace`
  capability (name, source repo/url/path as detail, the declaring settings file as origin), and
  add/remove/update run `claude plugin marketplace <verb>` through the same bounded, cwd-scoped,
  approve-the-argv pipeline as the plugin commands. No `--yes`: the marketplace subcommands do not prompt.
- **Moving a plugin between scopes is two of Claude's commands, install first** (`pluginMoveCommands` /
  `moveClaudePlugin`): `plugin install <id> --scope <to> --yes`, then the uninstall at the old scope.
  Install-first means a failure leaves the plugin still enabled somewhere; if the second half fails, the
  error says the plugin now lives in both scopes rather than pretending the move half-happened silently.
- **The program comes from the launcher's command line, its flags do not.** `AppConfig.claudeCommand` is a
  whole interactive invocation (`claude --dangerously-skip-permissions`, a wrapper script, an absolute
  path). A subcommand run takes the first token and nothing else, so a flag meant for a chat session cannot
  ride along into a destructive command.
- **The argv is composed once and shown before it runs.** `pluginUninstallCommand` is what the
  `claudeConfig.pluginUninstallPlan` method returns for the dialog to display and what
  `uninstallClaudePlugin` executes — one derivation, so the line the reader approves cannot drift from the
  line the host runs. This is the command-shaped twin of the diff the edit dialog shows.
- **Two ways in, both narrow.** `applyClaudeEdit` writes a *diff the user approved*, and
  `writeClaudeConfigFile` writes a *file the user edited by hand* in an editor tab. Both are gated on the
  same allowlist — only paths this workspace's resolver actually reports — and both compare-and-swap
  against the content that was shown. The editor path deliberately skips the approval dialog: that dialog
  exists so a change proposed *for* the user is seen before it lands, and typing into the file is already
  seeing it.

## Decisions

- **Provenance is the product, not a detail.** Every returned value carries its scope and file, and
  every value it shadows. A resolver that reported only the winner would answer "what" while leaving
  "why" exactly as unanswerable as it is today.
- **The pane links to Claude Code's reference; it does not restate it.** An earlier version embedded
  Anthropic's own one-line descriptions for each key. Any single phrase is probably too short to protect,
  but a systematic table of them is a different question, and this repository is Apache-2.0 — distributing
  it means granting rights we do not hold over that text. So only key *names* are kept, which are facts,
  and each resolved key links to its entry. `settingsDocs.ts` is generated by
  `scripts/generate-claude-settings-keys.ts`, **run by hand with its diff read**: fetching during the
  build would make two builds of one commit differ, break offline CI, and let a docs redesign change what
  ships unseen. The generator refuses to write a suspiciously short list rather than silently shrinking
  it — the first run caught exactly that, and also that the hand-made table had drifted to 55 keys of 210.
- **Settings flatten to dotted keys before resolving.** `permissions.defaultMode` resolves
  independently of `permissions.deny`, matching Claude Code's per-key deep merge. Resolving whole
  objects would claim a team's `deny` list was replaced when only `defaultMode` was overridden.
- **Lists union, scalars override.** `permissions.allow` and friends concatenate across every scope
  (deduped) because that is what Claude Code does; the pane still names each contributor, since "which
  file added this rule" is the question being asked of 154 accumulated rules. A union key holding a
  non-array in some scope falls back to override rather than guessing.
- **Instruction paths are returned in LOAD order, deliberately the reverse of settings precedence.**
  These concatenate rather than override: what loads last sits nearest the model, it does not win.
  Presenting them highest-precedence-first would teach the wrong model.
- **`@path` imports are expanded.** A one-line `CLAUDE.md` containing `@AGENTS.md` reports ~3 tokens
  while contributing thousands — the exact blindness the pane removes. Imports resolve relative to the
  importing file, `~` against home, four levels deep (Claude Code's limit), with a visited set so a
  cycle terminates.
- **Rules with a `paths:` glob are marked `lazy`.** They enter context only when Claude reads a matching
  file, so counting them as always-on weight would overstate every session's baseline.
- **Hooks are capabilities, and the sharpest of them.** A matched event runs a shell command with the
  user's permissions, so the pane lists every one — event, matcher, the command itself, and the file it
  came from — rather than leaving them as a settings key nobody reads. They have no individual switch;
  `disableAllHooks` turns off all of them at once, and a hook that it silenced says so and names the file.
- **MCP servers are read from `~/.claude.json`, not `settings.json`.** User and local scope genuinely
  live in that separate file — the sharpest trap in the surface, and one the resolver must not
  reproduce by looking in the intuitive place.
- **Sizes, never token counts.** The pane reported `bytes / 4` as an approximate token count. It was
  wrong in a direction that mattered — UTF-8 Cyrillic and CJK cost far more than that suggests, so the
  files most worth flagging read as the cheapest — and dressing a byte count as tokens claimed a
  precision nothing here had. Bytes are the fact we hold; a real tokenizer would be a heavy,
  vendor-specific dependency for a weight cue.
- **Unreadable is not empty.** A malformed JSON settings file becomes a reported problem, not a silently
  skipped scope — the difference between "your team has no settings" and "your team's settings are
  broken".
- **`inspected` lists files whether or not they exist**, so the pane can show absence. "There is no
  project settings file" is an answer; a missing row is not.

## Plugin install

- Writes exactly two keys to `<claudeHome>/settings.json`: an `extraKnownMarketplaces` entry sourcing
  this repo's marketplace manifest as a **directory**, and `enabledPlugins["thinkrail@thinkrail"]`.
  No marketplace publishing is involved.
- The marketplace path is **absolute**. A relative one resolves against the project being worked in,
  which is not where the plugin lives.
- `pluginStatus()` reports `absent` / `outdated` / `enabled`, or **`unknown`** when `~/.claude` could
  not be read — the offer is withheld rather than guessed at, since an install we cannot reason about
  is worse than no offer.
- The status carries `pendingChange`: the exact mutation, shown before consent. Nothing is written on
  detection alone.
- **Consent is asked once, for the registration — not once per version of it.** An entry that already
  exists is proof the user agreed to it, so `pluginStatusMaintained()` (what the host serves) rewrites an
  `outdated` entry in place and reports it as `enabled`; only `absent` — nothing registered at all — puts
  the offer back on screen. Re-asking was not caution, it was noise: the marketplace source is a
  **directory path**, so every worktree's host reads the previous worktree's path as a wrong one, and a
  user who works in two checkouts got the same prompt on every switch, forever. If the rewrite fails, the
  status stays `outdated` and the offer reappears — a failure to heal is exactly when asking is right.
- **A marketplace registered at a different path reads as `outdated`, not `enabled`.** The version alone
  cannot see a wrong path, and Claude Code surfaces one as a plugin error rather than ignoring it — so the
  offer has to come back for the user to repair it. `pluginRoot()` prefers `THINKRAIL_CLAUDE_PLUGIN_DIR`
  over its own module location, because a host that flattens this module into one file has no repo above
  it and would otherwise register a path inside its own bundle. The desktop app stages the marketplace
  into its bundle and sets that variable; see apps/desktop/SPEC.md.

## Reading a linked file

- The pane's click-through cannot go through `fs.readFile`: that is worktree-scoped by design, and most
  of Claude's configuration (user and managed scope) sits outside any worktree, so every such link
  failed silently. `readClaudeConfigFile` serves them instead, and rather than widening the worktree
  boundary for everyone it **re-resolves the snapshot and reads only a path that snapshot reports** —
  the allowlist is the resolver's own output, so this method cannot be turned into an arbitrary file
  read. The web client routes to it exactly when a path escaped the worktree (stays absolute).
- Files opened this way land in an ordinary editor tab, which has no read-only mode: **saving one back
  is not supported** and will fail against the worktree-scoped write. Editing user-scope configuration
  from the editor needs a write path that does not exist yet.
- **A link says *where in the file*, and says it as a key path — never as a line number.** A settings
  file holds dozens of keys and `~/.claude.json` holds every project's servers at once, so landing at
  line 1 leaves the reader to search for the entry they just clicked. `ClaudeConfigOrigin.keyPath`
  carries the JSON object keys instead (`["mcpServers", "git"]`), and the web client turns that into a
  line against the text the editor actually loaded. A line resolved *here* would be measured against
  the file as it was when the snapshot was built and would point at the wrong row the moment anything
  above it changed; a key path stays true across every edit that does not delete the key. It also costs
  one lookup per click rather than a scan per resolved key.
- `flatten` therefore returns each leaf's **segments** alongside its dotted key. The dotted form is the
  identity a key is matched by across scopes, but it cannot be split back into segments — Claude Code's
  `env` block takes arbitrary variable names, and a key with a dot in it would split into positions no
  file has.
- A capability whose origin *is* a file — a skill directory, an agent `.md` — carries no `keyPath`, and
  neither does a context layer or a problem: there the file is the value, so line 1 is the whole
  answer.

## Editing, with the scope named and the diff shown

The pane can now write, and everything about how is a response to the same complaint: Claude Code lets you
disable an MCP server without ever saying **which of six mechanisms across four files** it used. So:

- **The scope is always chosen, never guessed.** Every edit starts by asking where it goes, with each
  option described by who it affects — "you, in every project on this machine" / "everyone who works on
  this project (checked into git)" / "you, in this project only (usually gitignored)" — not by a path. A
  preselected default would be the same silent decision this replaces. `managed` is not offered: it
  belongs to whoever deploys it.
- **Nothing is written without an approved diff.** `planClaudeEdit` computes the change and returns it as
  a line diff; `applyClaudeEdit` writes it. The diff exists mainly to show what an edit *removes* — a
  generated config change that quietly drops a key is precisely the failure a summary sentence cannot
  show, and the reason a resolver bug here would otherwise be silent.
- **Approval is pinned to content.** The plan carries a hash of what it was built from, and applying
  refuses if the file moved since; the diff the user approved would no longer be the change that lands.
- **A conflict warns, never refuses.** If a higher-precedence file already decides the key, the dialog
  says so before writing. Editing a losing file is a real thing to want — preparing a project setting
  while a managed policy holds — so it stays the user's call.
- **Edits preserve the file's own formatting** (`formatJson` copies its indentation), because a wholesale
  reformat would bury the one line that matters in a diff of the entire file.
- MCP denial writes `deniedMcpServers`, which applies in every scope, rather than the `enabledMcpjsonServers`
  / `disabledMcpjsonServers` pair that only governs a project's `.mcp.json`. It resolves as a **union**
  across scopes, matching Claude Code: a server denied anywhere is denied.

### What can be edited, and by what mechanism

Each edit kind exists because Claude Code has exactly one honest way to express that change; the pane
picks it rather than making the user learn which of six mechanisms applies.

- **`setting`** — any key, at any dotted path, set to text, a number, an on/off value or a list of text,
  or removed with `null`. A value the pane cannot represent as one of those (a nested object) is not
  editable here at all: the row says so and hands off to the editor, rather than offering a control that
  would silently flatten it. A key that appears in no file yet can still be added — the documented key
  names are offered as completions, and an unlisted key is accepted as "newer than our list".
- **`mcp`** — allow or deny, both directions. Denial is what an existing server answers to.
- **`mcp-add`** — a new server, declared where Claude Code looks for one, which is **never
  `settings.json`**: project scope writes the repo's `.mcp.json`, and the two personal scopes write
  `~/.claude.json` — user scope at its top level, local scope under `projects[<worktree>]`.
- **`plugin`** — `enabledPlugins["<name>@<marketplace>"]`, written as an explicit `true`/`false`.
- **`skill`** — `skillOverrides["<name>"] = "off"`. Turning a skill back on **removes** the entry rather
  than writing `"on"`: the absence of an override is the enabled state, and a leftover `"on"` would claim
  a decision the user did not make. There is no equivalent for a **subagent** — Claude Code has no
  setting that disables one — so agent rows say "no switch" instead of inventing a mechanism.
- **`skill-create`** — a skill's `SKILL.md`, with the frontmatter Claude Code reads. The name becomes the
  directory (lowercased, hyphenated) and the frontmatter's `name`, so the two cannot drift; a description
  is required, because it is the whole of what Claude reads when deciding whether to use a skill. Two
  scopes only — `~/.claude/skills` and `.claude/skills` — since there is no private third one. An existing
  skill is never overwritten: the pane offers to create one, not to replace one.
- **`hook`** — an entry under `hooks.<Event>`. A hook on a matcher that already has a group **joins that
  group** rather than opening a rival one, which is what Claude Code's own examples do and what keeps two
  commands on the same trigger from becoming two groups that both fire. `PreToolUse` / `PostToolUse` take
  a tool matcher; the other events do not, and the form does not offer one there.
- **`plugin-add`** — an `extraKnownMarketplaces` entry plus the `enabledPlugins` flag under it, in one
  edit, because a plugin id is `<plugin>@<marketplace>` and enabling one without registering the other
  records a plugin Claude Code cannot find. The source is a GitHub `owner/repo` or a directory path.
- **`file`** — a `CLAUDE.md` / `CLAUDE.local.md` from a template.

### The scope offer is per edit kind

`claudeEditScopes(edit)` (in `contracts`) decides which scopes an edit may land in, and the host refuses
anything else — a template names one file, so offering three scopes that all write the same path was
theatre dressed as a choice. Everything else offers all three writable scopes.

### The diff elides what is far from the change

A diff of the whole file was right while the only targets were small settings files. `~/.claude.json`
is neither small nor safe to display: it holds auth tokens and trust decisions. `diffLines` therefore
keeps three lines of context around each change and collapses the rest into a `gap` line carrying the
count. The elision is also what keeps the one changed line findable in a file of hundreds.

## Restrictions

- **Every write goes through `planClaudeEdit` / `applyClaudeEdit` or `installPlugin`,** and each shows the
  exact change before it happens — the diff for the former, the pending mutation for the latter. Nothing
  in this module writes on detection alone.
- **`~/.claude.json` is written for exactly one thing: declaring an MCP server**, because that is where
  Claude Code keeps user- and project-local servers and there is no other file that would work. The
  write touches only the `mcpServers` object (top level, or under `projects[<worktree>]`), goes through
  the same approved diff and compare-and-swap as everything else, and the diff's elision keeps the auth
  tokens elsewhere in that file off the screen. Nothing else in it — trust decisions, history,
  credentials — is ever touched.
- **The file follows `CLAUDE_CONFIG_DIR`**, exactly as Claude Code resolves it: `$CLAUDE_CONFIG_DIR/.claude.json`
  when that is set, `~/.claude.json` otherwise. Reading it from `homedir()` unconditionally meant an
  isolated host (or a test) reported and would have written the developer's own file.

## Validation

- `edits.test.ts` — one test per edit kind: a list value, a removal, a number that stays a number, a
  plugin switched off, a skill override written and then removed, a server landing in `.mcp.json`, the
  two malformed-server refusals, the scope refusal, elision, and the compare-and-swap.
- `capabilities.test.ts` — what makes a capability read as *off*: `deniedMcpServers`,
  `disabledMcpjsonServers`, a skill override, and the agent that has no switch at all; plus the
  per-project servers in `~/.claude.json` reported as local scope.
- `e2e/claude-config.spec.ts` — the whole journey through the real UI: compose a value, refuse to plan
  before a scope is chosen, read the diff, apply, and find the file on disk changed.
- `merge.test.ts` — flattening, scalar override with shadow chain, list union with dedupe, sibling keys
  resolving from different scopes, non-array fallback, empty input, and the segments a dotted key with a
  dot inside one of its names cannot be split back into.
