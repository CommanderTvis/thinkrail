---
id: plugin-adoption
type: task-spec
status: draft
title: Adopting the plugin API — core seams and the features that move
parent: module-plugin-api
depends-on: [module-plugin-api]
references:
  [
    module-server,
    module-web,
    module-spec-graph,
    submodule-server-spec,
    submodule-server-terminal,
    submodule-web-shell-layout,
    submodule-web-panels,
    module-repo-scripts,
  ]
tags: [v1, plugins, migration]
---

[[module-plugin-api]] describes the contract in the abstract. This document is the plan to reach it: the
core seams the contract assumes and the features that move onto it. Once the contract exists, the external
plugins below live in their authors' own repositories.

Eight features set the scope. Seven come from one external contributor's fork, on the
`claude-code-integration` branch of `CommanderTvis/thinkrail`, which is rebased as upstream moves, so
commits from it are cited by message rather than by hash. Each of those landed as a cross-cutting edit
through core: Claude Code integration, Blueprint, Discord Rich Presence, PDF preview,
visualize-beside-terminal, the branch graph, and file-type icons, the last of them provisionally. The eighth
is in core today and should not be: the spec dialect viewer, whose agent side is already a portable extension while its UI, its wire read, and its side
tool sit in the middle of the app.

Much of the rest of that fork is not plugin material. It is fixes and features every ThinkRail user should
have, most of them already filed upstream as issues, and they are listed at the end of this document because
they shape nothing here.

## Core seams

Each is a capability or mechanism the Plugin API needs from core.

| seam | source | what core gains |
| --- | --- | --- |
| **S1** terminal identity and agent record | the terminal parts of "Claude Code integration: status, configuration pane, plugin" and "Terminals stop fighting the programs running in them" | token mint, resolve, forget; a terminal marker variable; the env-contributor seam; a typed agent record on the wire and on disk, typed rather than an opaque per-plugin bag so that other plugins can read a session id without reading Claude Code's contract; observer events with pid; a revive-hook table feeding `terminal.attach`, offering a prefill rather than writing the command, since a host-side write would land before the shell prompt and before any client could decline it; a host-internal write. Not the `ps` poll, resume-command composition, title-glyph adoption, OSC filtering, or auto-submit, which are Claude semantics, so that with Claude Code disabled no process sweep runs at all |
| **S2** per-terminal MCP tool table | "The spec tools reach any agent in a ThinkRail terminal, over MCP" | the MCP module and token route as-is, its table fed by the loader; agent-free tool definitions |
| **S3** embedded companion panes | "Panes a resource carries: embedded, never a tab of their own", "A chat shows a visualization once, where it happened" | the split primitive, the pane slice, terminal and chat hosts, with the companion kind opened to a registry read through a hook so availability stays reactive. The largest of these changes, since it rewrites terminal chrome |
| **S4** file-open dispatch | "web: PDF preview", Blueprint's open intercept | one ordered dispatcher consulted by the open path, the body renderer, and the rehydrate path, reading its strategy from the roster, with a viewer able to handle an open outright and a raw bypass. It changes three call sites at once, so the e2e that opens a PDF, reloads, and asserts no text read is what pins the site the fork missed |
| **S5** settings namespaces and the roster | shaped after "Discord Rich Presence" | `AppConfig.plugins` with per-namespace merge; `AppConfig.pluginPaths`; the roster on welcome plus `plugins.list` and `plugins.changed`; the generation constant; the tool-id pattern; Settings › Plugins |
| **S6** the two loaders | the fork's five install/teardown pairs, handler growth, transport growth | `packages/server/src/plugins` (registry and adapters; contracts, plugin-api, log, persistence only, with host-injected closures) and `apps/web/src/plugins` split into a leaf registry and a composition-root loader, plus the editor-event emitter, the layout tool catalog, dependency resolution, and the serialised reconciler with its activation ids, in-flight drain, and bounded disposer await |
| **S7** a host file picker | the picker generalisation inside "Claude Code integration" | a core wire method with an e2e override, surfaced through W13 |
| **S8** bounded async subprocess | — | the bounded runner moves into `@thinkrail/shared`, and server `subprocess` re-exports it. The only shared option today is synchronous, and a multi-second CLI probe on the event loop is not acceptable |
| **S9** build support and boundary tooling | the fork's desktop staging | builtin plugin assets and skill dirs into binary and desktop; the subpath and types-only rules; the matcher test; the web-bundle and shared-runtime gates; the seams loop; the committed API report and its check; `e2e/plugins/<id>/` |
| **S10** the plugin UI runtime | — | `packages/plugin-ui`: the eleven shadcn primitives moved out of `apps/web/src/components/ui` with the app importing them from the package, plus the markdown renderer, the code editor, and the visualization card, and the token-name contract they style against. The editor reads only a handful of display settings from the store, which become props, and the card is already props-driven, so neither is a rewrite. Also the host-installed global registry for shared externals, and the loader that fetches, injects, and disposes an out-of-bundle web half |
| **S11** external-plugin loading | — | the manifest reader and its refusal reasons, the directory scan over `<dataDir>/plugins` plus `AppConfig.pluginPaths`, the rescan action, the absolute-path host import with its allowlisted seam entry and content-hash version query, serving the web half and assets, the Settings rows |
| **S12** plugin-supplied pi extensions | — | the `pi` block: extension entries and skill dirs from a plugin reaching `buildResourceLoader`, factories and staged skills for builtin plugins and real paths for external ones, `group = plugin id` on the skills, the opt-in for sub-agent sessions, and the declaration that a plugin modifies the system prompt |
| **S13** the file icon slot, provisional | "File-type icons, in the theme's own colour" and the icon half of "Changed files carry their icon, and a way into the file itself" | one component that renders a file's icon, consulted by the file tree, workbench tabs, chat file chips, the composer mention menu, and changes rows, in place of four independent Remix imports and one site with no icon. With no resolver registered it renders today's generic glyphs |

## The features

### The spec dialect, builtin, first

The spec dialect becomes the first builtin plugin, and it is the only feature here that is not a fork port.
It comes first because a contract with no plugin exercising it cannot be judged against anything real,
because it is upstream's own feature, and because Blueprint waits on it.

`packages/spec-graph` survives unchanged and stays installable in plain pi. Its parser at `./core` cannot
move in any case, because both `packages/server/src/spec` and `scripts/specSurface.ts` consume it, and the
latter is the repo's own `check:spec-surface` gate. The plugin therefore declares the package in its `pi`
block rather than absorbing it, and turns on the sub-agent flag, because the curated child extension set
includes spec tools today and that should not regress.

What moves into the plugin: the `spec.graph` read that `packages/server/src/spec` serves, the Specs side
tool, the seven `spec_*` renderers that `chat/tools/register.ts` wires by hand, and `SpecsPanel`,
`specTree`, and `useWorkspaceSpecs` as its web half.

What stays in core: `project.hasSpecs`, because the Welcome screen asking whether a repository carries
specs is a question about the repository, and core should not render differently depending on whether a
plugin is switched on. "A project with no specs opens its rail on Files" is a second core consumer of that
read, since the shell picks the rail's default tab from it. That choice has to account for the plugin too:
a repository with specs defaults to the Specs tool only while the plugin is active, and otherwise to Files,
or the default lands on a dormant placeholder.

Two migrations come with it. The tool id becomes namespaced, so `specs` no longer resolves: three builtin
presets name it, host-persisted custom presets can name it, and every browser's local layout document can
place it. The fork has since made a workbench frame belong to the project it was arranged in, so there is
one such document per project rather than one per surface, and the mapping from the legacy id has to walk
all of them, running where the layout document and the preset list are already validated. Separately, the
chat can reveal the Specs tab from a turn, naming that tool directly; that becomes the generic reveal-by-id
verb in W16, so the chat stops naming a specific tool.

It ships enabled by default, so behaviour is unchanged for anyone who leaves it on. It carries no
dependency, which is what lets Blueprint depend on it, and upstream ownership is what makes that dependency
safe to declare, since it moves with the API generation rather than against it. Needs S5, S6, S10, S12, and
the W5 catalog.

### Claude Code integration, external

Config and IDE methods over H1; a state channel for status and an addressed event channel for IDE actions;
the hook plugin's status POST over H3, resolving the terminal token, remembering the agent record, and
feeding auto-naming; H5 for the status URL and bridge port; its own `ps` poll off H8; H9 composing the
resume command; and a second `Bun.serve` listener across activate and dispose. Its Claude marketplace
directory ships inside the plugin directory, so the fork's desktop staging and environment variable are no
longer needed. On the web: a settings section, a configuration side tool, tab adornments, terminal chips,
an agent launcher, and editor events into the bridge with actions addressed back.

Its configuration writes compare against a content hash, and so do its IDE tools that save documents. Both
lean on editor saving, which is upstream work tracked as #370, and on its hash helpers being reachable from
`@thinkrail/shared` rather than only inside server `fs`, since a host half may not import the server. Needs
S1, S2, S7, S8, S9, S10, S11.

### Blueprint, external

Parser, prompts, and session logic move unchanged; nine methods and a keyed state channel; its check tool
registered once and served on both surfaces; the fs-watch tap by path suffix with an explicit watch call,
so a Claude-terminal workspace has a watcher after reload; delivery moves host-side through H10 or H11,
which fixes the throw-while-streaming bug. On the web: a companion on terminal and chat hosts, a viewer
handling the open of `BLUEPRINT.md` itself, a workspace action, and author start and resume through the
launcher registry.

It declares one dependency, on the spec dialect. A blueprint is a spec-graph node, so it takes that
vocabulary from the dependency's contract types and reads the graph through its methods, rather than the
fork's arrangement where the document happens to carry the right frontmatter and the core spec module
happens to index it. It is the worked example of an external plugin depending on a builtin one. Needs S1,
S2, S3, S4, S5, S6, S10, S11, and the spec dialect first.

### Discord Rich Presence, external

The IPC client, the pure presence decision, and the connection lifecycle move unchanged; two methods and a
state channel; the snowflake validation the fork inlined into core config loading becomes its settings
schema; the whole-store subscription becomes a selector. The smallest port, and therefore the one that
proves external loading end to end. Needs S5, S6, S10, S11.

### PDF preview, external

Web only, with no host half. Its viewer is declared in the manifest so the dispatcher knows the read
strategy before the module loads, and the component comes from the web half. W14 replaces the private URL
builder and the hand-rolled live reload. The find bar and the zoom gesture it uses stay in the app. Needs
S4, S6, S10, S11.

### Visualize beside a terminal, external

An external plugin wrapping an upstream pi extension rather than an upstream plugin: the tool is registered
from `pi-visualize`'s own definition, which stays in core and installable in plain pi, with an MCP-only
surface. Its run records, publishes, and awaits the browser's render verdict; a keyed state channel carries
the result; and drawings are persisted per agent session, adopted when a resumed agent reports its id. On
the web: a companion rendering the kit's visualization card. Needs S1, S2, S3, S6, S10, S11.

### Branch graph, external

"A graph of the project's branches, in the rail" renders a commit graph as a side tool, with its own
lane-assignment algorithm, over a `git.graph` read keyed by project rather than workspace.

It is the feature that makes git a capability. A plugin could spawn git itself, since a host half is
ordinary Bun code, but it would have to re-derive the runner's bounded, prompt-free child and
`GIT_OPTIONAL_LOCKS=0`, whose absence is the self-sustaining watcher loop reported as #438. It is also the
reason H12 covers projects and not only workspaces, because the read is project-scoped. Needs S5, S6, S10,
S11, the W5 catalog, and H17.

### File-type icons, external, provisional

#411 asks for file-type icons in core. Until upstream takes the fork's implementation as it is, they are
prototyped as a plugin, and W17 and S13 exist for that case. If core adopts them, both go away and this
feature moves to the upstream table below.

Web only, with no host half. It registers one resolver mapping a path and kind to a glyph, and ships the
glyph set as plugin assets served under its own route. The fork recolours every SVG to `currentColor` at
build time so the icons follow the theme; that step belongs to the plugin's build rather than to core, as
does the shape of the set: serving 1,251 separate SVGs over a plugin route trades one large fetch for a
thousand small ones, and shipping a sprite or an inlined set is the plugin's problem to solve.

It needs an exception to the icons-only invariant. The plugin's own identity icon in the roster stays a
Remix name, while the file glyphs it provides are its own assets, and the exception is bounded to this slot.
It is also the case of a provider consumed by another plugin, since Claude Code's attach picker draws the
same icons, and that happens through the core slot rather than a plugin-to-plugin edge. Needs S6, S10, S11,
S13.

### Not in scope

The remaining plugin-shaped fork features, namely markdown outline, file-tree actions,
send-selection-to-chat, and project sources, are out of scope. Each would reuse this API later, and none
adds a capability the eight already require.

Among the bundled pi extensions, only spec-graph's extension half moves. Todos and workflow are
plugin-shaped but wired into core surfaces that would have to move with them, since `pi-todos/core` backs
the `todo.*` wire methods and the plan document tab. Visualize stays in core as a package, wrapped by an
external plugin. Web-access is a third-party npm package the host adapts with a policy hook, so it is not
ours to package.

## Upstream, not plugins

These landed on the same fork but belong in core. They are fixes and features every user should have, and
none of them needs a plugin capability, so they do not shape this API.

| on the fork | upstream |
| --- | --- |
| the editor writing files, with compare-and-swap against a content hash | #370 |
| an image opening as a picture rather than its bytes | #439 |
| a branch list from the topbar that can clean up old branches | #416 |
| spec documents titled by their frontmatter, with resolving `[[links]]` | #479 |
| markdown frontmatter shown as properties in the preview | #362 |
| vertical tabs and panes, for users with many tabs | #410 |
| a chosen code font with ligatures | #431 |
| host git reads no longer feeding the watcher | #438 |
| terminals running as the right user, and thawing after sleep | #427, #428 |
| the desktop keeping its own links, a native title bar, issue numbers not painted as colours, auto-naming leaving pushed branches alone | #372, #346, #451, #457 |
| workspace search from one popup | no issue filed |
| performance work: resizing and folding without rebuilding the workbench, large markdown previews, the editor and terminals drawn by the GPU, terminals that stop rendering offscreen | no issue filed |

Three plugins above lean on items in this table. Claude Code needs editor saving, PDF preview uses the find
bar and zoom gesture, and visualize renders the diagram card in the interactive mode the fork's diagram fixes
introduced. None of that is a reason to model those items as plugin capabilities.

## Parent-spec edits this plan assumes

Adopting the contract also means writing: `architecture.md`'s ring topology, for `packages/plugin-api`,
`packages/plugin-ui`, the plugin packages, and `apps/web`'s widened edges; `apps/web/SPEC.md`, whose
Boundary says `@thinkrail/contracts` only today, plus rows and graph edges for the web registry and loader,
and the primitives moving to the kit; `packages/server/SPEC.md`'s module table and internal graph;
`panels/SPEC.md` and `shell/SPEC.md` allowed deps; `submodule-web-shell-layout` for the tool catalog
parameter; the `settings`, `persistence`, and `terminal` specs for the namespace merge, the state root, and
the identity seam; `submodule-server-spec` for the read moving to a plugin while `project.hasSpecs` stays;
`scripts/SPEC.md` for the new rules and gates; and AGENTS.md's web-dependency invariant, together with its
icons-only rule, which gains the bounded file-glyph exception for as long as file-type icons are a plugin.
