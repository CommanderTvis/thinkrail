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
core seams the contract assumes, the features that move onto it, and the order of work.

Eight features set the scope. Seven come from one external contributor's fork, on the
`claude-code-integration` branch of `CommanderTvis/thinkrail`, which is rebased as upstream moves, so
commits from it are cited by message rather than by hash. Each of those landed as a cross-cutting edit
through core: Claude Code integration, Blueprint, Discord Rich Presence, vertical tabs, PDF preview,
visualize-beside-terminal, and file-type icons. The eighth is in core today and should not be: the spec
dialect viewer, whose agent side is already a portable extension while its UI, its wire read, and its side
tool sit in the middle of the app.

## Core seams

Each is a host-owned capability and its own PR.

| seam | source | what lands |
| --- | --- | --- |
| **S0** mergeable prerequisites | the fork commits "Resizing a column stops rebuilding the workbench under it", "A tool shown from a group's menu lands in that group", "An empty group's strip shows its remove cross only when it can act", "A middle click closes the tab you press it on", the tooltip half of "web: our own tab tooltips", the find bar from "Cmd+F finds text in every preview", the zoom gesture and interactive tool renderers from "A diagram you can get around in", the render-verdict prop from "A diagram that will not parse tells the agent" | plain merges; tolerant preference parsing rides along |
| **S1** terminal identity and agent record | the terminal parts of "Claude Code integration: status, configuration pane, plugin" and "Terminals stop fighting the programs running in them" | token mint, resolve, forget; a terminal marker variable; the env-contributor seam; a typed agent record on the wire and on disk, typed rather than an opaque per-plugin bag so that other plugins can read a session id without reading Claude Code's contract; observer events with pid; a revive-hook table feeding `terminal.attach`, offering a prefill rather than writing the command, since a host-side write would land before the shell prompt and before any client could decline it; a host-internal write. Not the `ps` poll, resume-command composition, title-glyph adoption, OSC filtering, or auto-submit, which are Claude semantics, so that with Claude Code disabled no process sweep runs at all |
| **S2** per-terminal MCP tool table | "The spec tools reach any agent in a ThinkRail terminal, over MCP" | the MCP module and token route as-is, its table fed by the loader; agent-free tool definitions |
| **S3** embedded companion panes | "Panes a resource carries: embedded, never a tab of their own", "A chat shows a visualization once, where it happened" | the split primitive, the pane slice, terminal and chat hosts, with the companion kind opened to a registry read through a hook so availability stays reactive. The largest of these merges, since it rewrites terminal chrome |
| **S4** file-open dispatch | "web: PDF preview", "An image opens as a picture, not a Monaco buffer of its bytes", Blueprint's open intercept | one ordered dispatcher consulted by the open path, the body renderer, and the rehydrate path, reading its strategy from the roster, with a viewer able to handle an open outright and a raw bypass. It changes three call sites at once, so the e2e that opens a PDF, reloads, and asserts no text read is what pins the site the fork missed |
| **S5** editor save with content-hash CAS | "The editor writes files, and never over someone else's edits", minus its fork-feature hunks | the CAS, with hash and positioned read/write helpers in `@thinkrail/shared` re-exported by server `fs`, so a plugin and the editor share one implementation |
| **S6** settings namespaces and the roster | shaped after "Discord Rich Presence" | `AppConfig.plugins` with per-namespace merge; `AppConfig.pluginPaths`; the roster on welcome plus `plugins.list` and `plugins.changed`; the generation constant; the tool-id pattern; Settings › Plugins |
| **S7** the two loaders | the fork's five install/teardown pairs, handler growth, transport growth | `packages/server/src/plugins` (registry and adapters; contracts, plugin-api, log, persistence only, with host-injected closures) and `apps/web/src/plugins` split into a leaf registry and a composition-root loader, plus the editor-event emitter, the layout tool catalog, dependency resolution, and the serialised reconciler with its activation ids, in-flight drain, and bounded disposer await |
| **S8** a host file picker | the picker generalisation inside "Claude Code integration" | a core wire method with an e2e override, surfaced through W13 |
| **S9** bounded async subprocess | — | the bounded runner moves into `@thinkrail/shared`, and server `subprocess` re-exports it. The only shared option today is synchronous, and a multi-second CLI probe on the event loop is not acceptable |
| **S10** build support and boundary tooling | the fork's desktop staging | builtin plugin assets and skill dirs into binary and desktop; the subpath and types-only rules; the matcher test; the web-bundle and shared-runtime gates; the seams loop; the committed API report and its check; `e2e/plugins/<id>/` |
| **S11** the plugin UI runtime | — | `packages/plugin-ui`: the eleven shadcn primitives moved out of `apps/web/src/components/ui` with the app importing them from the package, plus the markdown renderer, the code editor, and the visualization card, and the token-name contract they style against. The editor needs two props where it reads the store today, and the card is already props-driven, so neither is a rewrite. Also the host-installed global registry for shared externals, and the loader that fetches, injects, and disposes an out-of-bundle web half |
| **S12** external-plugin loading | — | the manifest reader and its refusal reasons, the directory scan over `<dataDir>/plugins` plus `AppConfig.pluginPaths`, the rescan action, the absolute-path host import with its allowlisted seam entry and content-hash version query, serving the web half and assets, the Settings rows |
| **S13** the file icon slot | "File-type icons, in the theme's own colour" and the icon half of "Changed files carry their icon, and a way into the file itself" | one component that renders a file's icon, consulted by the file tree, workbench tabs, chat file chips, the composer mention menu, and changes rows, in place of four independent Remix imports and one site with no icon. With no resolver registered it renders today's generic glyphs |
| **S14** plugin-supplied pi extensions | — | the `pi` block: extension entries and skill dirs from a plugin reaching `buildResourceLoader`, factories and staged skills for builtin plugins and real paths for external ones, `group = plugin id` on the skills, the opt-in for sub-agent sessions, and the declaration that a plugin modifies the system prompt |

## The features

### The spec dialect, builtin, first

The spec dialect becomes the first builtin plugin, and it is the only feature here that is not a fork port.
It is first because a builtin exercises the contract without the external loader or the kit being finished,
and because Blueprint waits on it.

`packages/spec-graph` survives unchanged and stays installable in plain pi. Its parser at `./core` cannot
move in any case, because both `packages/server/src/spec` and `scripts/specSurface.ts` consume it, and the
latter is the repo's own `check:spec-surface` gate. The plugin therefore declares the package in its `pi`
block rather than absorbing it, and turns on the sub-agent flag, because the curated child extension set
includes spec tools today and that should not regress.

What moves into the plugin: the `spec.graph` read that `packages/server/src/spec` serves, the Specs side
tool, the seven `spec_*` renderers that `chat/tools/register.ts` wires by hand, and `SpecsPanel`,
`specTree`, and `useWorkspaceSpecs` as its web half. What stays in core: `project.hasSpecs`, because the
Welcome screen asking whether a repository carries specs is a question about the repository, and core
should not render differently depending on whether a plugin is switched on.

Two migrations come with it. The tool id becomes namespaced, so `specs` no longer resolves: three builtin
presets name it, host-persisted custom presets can name it, and every browser's local layout document can
place it. A mapping from the legacy id runs where the layout document and the preset list are already
validated. Separately, the chat can reveal the Specs tab from a turn, naming that tool directly; that
becomes the generic reveal-by-id verb in W17, so the chat stops naming a specific tool.

It ships enabled by default, so behaviour is unchanged for anyone who leaves it on. It carries no
dependency, which is what lets Blueprint depend on it, and upstream ownership is what makes that dependency
safe to declare, since it moves with the API generation rather than against it. Needs S6, S7, S11, S14, and
the W5 catalog.

### Claude Code integration, external

Config and IDE methods over H1; a state channel for status and an addressed event channel for IDE actions;
the hook plugin's status POST over H3, resolving the terminal token, remembering the agent record, and
feeding auto-naming; H5 for the status URL and bridge port; its own `ps` poll off H8; H9 composing the
resume command; and a second `Bun.serve` listener across activate and dispose. Its Claude marketplace
directory ships inside the plugin directory, so the fork's desktop staging and environment variable are no
longer needed. On the web: a settings section, a configuration side tool, tab adornments, terminal chips,
an agent launcher, and editor events into the bridge with actions addressed back. Needs S1, S2, S5, S8, S9,
S10, S11, S12.

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
S2, S3, S4, S6, S7, S11, S12, and the spec dialect first.

### Discord Rich Presence, external

The IPC client, the pure presence decision, and the connection lifecycle move unchanged; two methods and a
state channel; the snowflake validation the fork inlined into core config loading becomes its settings
schema; the whole-store subscription becomes a selector. The smallest port, and therefore the one that
proves external loading end to end. Needs S6, S7, S11, S12.

### PDF and image preview, external

Web only, with no host half. Viewers are declared in the manifest so the dispatcher knows the read strategy
before the module loads, and components come from the web half. W14 replaces the private URL builder and
the hand-rolled live reload. The find bar and the zoom gesture stay in the app. Needs S0, S4, S7, S11, S12.

### Visualize beside a terminal, external

An external plugin wrapping an upstream pi extension rather than an upstream plugin: the tool is registered
from `pi-visualize`'s own definition, which stays in core and installable in plain pi, with an MCP-only
surface. Its run records, publishes, and awaits the browser's render verdict; a keyed state channel carries
the result; and drawings are persisted per agent session, adopted when a resumed agent reports its id. On
the web: a companion rendering the kit's visualization card. Needs S0, S1, S2, S3, S7, S11, S12.

### File-type icons, external

Web only, with no host half. It registers one resolver mapping a path and kind to a glyph, and ships the
glyph set as plugin assets served under its own route. The fork recolours every SVG to `currentColor` at
build time so the icons follow the theme; that step belongs to the plugin's build rather than to core, as
does the shape of the set: serving 1,251 separate SVGs over a plugin route trades one large fetch for a
thousand small ones, and shipping a sprite or an inlined set is the plugin's problem to solve.

This is the one feature needing an exception to the icons-only invariant. The plugin's own identity icon in
the roster stays a Remix name, while the file glyphs it provides are its own assets, and the exception is
bounded to this slot. It is also the case of a provider consumed by another plugin, since Claude Code's
attach picker draws the same icons, and that happens through the core slot rather than a plugin-to-plugin
edge. Needs S7, S11, S12, S13.

### Vertical tabs and panes, not a plugin

A strip-mode slot would export the tab-strip props and drag bindings out of a 3,300-line engine for a
single implementer, and would hand a plugin the surface where drop targets, context-menu verbs, and the
"tools stay in a side region" rule are enforced. Panes are model invariants inside three core operations.
The feature lands in the layout module behind a local preference, minus its leaked Claude hunks, after S0,
with the tolerant parse and a view validator that admits pane metadata. The fork got both of those wrong,
and a pane present at reload resets the layout there.

### Not in scope

The remaining plugin-shaped fork features, namely markdown outline, frontmatter properties, file-tree
actions, send-selection-to-chat, and project sources, are out of scope. Each would reuse this API later,
and none adds a capability the eight already require.

Among the bundled pi extensions, only spec-graph's extension half moves. Todos and workflow are
plugin-shaped but wired into core surfaces that would have to move with them, since `pi-todos/core` backs
the `todo.*` wire methods and the plan document tab. Visualize stays in core as a package, wrapped by an
external plugin. Web-access is a third-party npm package the host adapts with a policy hook, so it is not
ours to package.

## Order of work

1. S0, the mergeable prerequisites, which stand on their own.
2. S6 and S7: settings namespaces, the roster, and the two loaders with the reconciler. Nothing else can be
   demonstrated without them.
3. S11 and S14: the UI kit and plugin-supplied pi extensions.
4. The spec dialect as the first builtin plugin, including its two migrations. This is the point at which
   the contract has carried a real feature.
5. S12, external loading, proved by Discord as the smallest external port.
6. S1, S2, S3, S4, S5, S8, S9, S13 as the features that need them arrive.
7. Claude Code and Blueprint, in that order, since Blueprint depends on the spec dialect and reaches Claude
   through the launcher registry rather than directly.

## Parent-spec edits this plan assumes

The PR that lands S6 and S7 must also write: `architecture.md`'s ring topology, for `packages/plugin-api`,
`packages/plugin-ui`, the plugin packages, and `apps/web`'s widened edges; `apps/web/SPEC.md`, whose
Boundary says `@thinkrail/contracts` only today, plus rows and graph edges for the web registry and loader,
and the primitives moving to the kit; `packages/server/SPEC.md`'s module table and internal graph;
`panels/SPEC.md` and `shell/SPEC.md` allowed deps; `submodule-web-shell-layout` for the tool catalog
parameter; the `settings`, `persistence`, and `terminal` specs for the namespace merge, the state root, and
the identity seam; `submodule-server-spec` for the read moving to a plugin while `project.hasSpecs` stays;
`scripts/SPEC.md` for the new rules and gates; and AGENTS.md's web-dependency invariant together with its
icons-only rule, which gains the bounded file-glyph exception.
