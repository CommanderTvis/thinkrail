---
id: module-tab-host
type: module-design
status: active
title: tab-host — the ThinkRail Playground's host inside a browser tab
parent: architecture
depends-on: [module-contracts, module-plugin-api]
references: [module-web, submodule-web-transport]
---

## Responsibility

A second, lean host that runs in a Web Worker of the page, for a browser with no ThinkRail process to
connect to. It answers the same wire protocol as `packages/server` for the subset a project living in the
tab needs — projects, files, git, pi chats, providers, settings, plugins — and answers every other method
with a plain "not available while ThinkRail runs in this tab" error. The welcome carries
`hostKind: "tab"`.

## Boundary

- **Owns:** the tab's filesystem, its OPFS mirror, the in-tab pi sessions and their tools, git over
  isomorphic-git, the in-worker plugin host, and the worker entry.
- **Public surface:** `index.ts` (`TabHost`, `startTabHost`, the filesystem and mirror) for tests and
  embedders; `./worker` is the module the web transport starts as a Worker; `./build-support` names the
  Node-builtin shims the web build resolves inside that worker.
- **Allowed dependencies:** `contracts`, `plugin-api`, and the builtin plugin packages (their manifests,
  and the host halves that run in a tab); `@earendil-works/pi-ai` and `pi-agent-core` as values.
- **Forbidden:** `packages/server`, `packages/shared`, `@earendil-works/pi-coding-agent` beyond its
  truncation module, any process,
  socket, or native filesystem API.

## Design

- **Filesystem.** One memfs volume (`volume.ts`) is the whole filesystem: Node's sync, callback and promise
  API, so isomorphic-git, the agent's tools and plugin host halves that call `node:fs` share it. The web
  build resolves `node:fs`/`fs` to that volume and `node:path`, `events`, `buffer`, `stream`, `url`, `os`,
  `zlib` to browser stand-ins, inside the worker only. `@earendil-works/pi-coding-agent` resolves to its own
  dependency-free truncation module there, the one part spec-graph's tools use; its root loads host-only
  configuration. Any other import from it fails the build. The volume is restored from the OPFS directory
  `thinkrail-tab-host` on start and flushed back shortly after each change by diffing mtimes and sizes, so
  a reload finds the same tree. Trade-off: the whole tree lives in memory; a large clone costs RAM.
- **Layout.** Projects live under `/projects`; each project has exactly one workspace, its default one
  (`ws_<projectId>`), since there are no worktrees. Host state, credentials and transcripts live under
  `/.thinkrail` in the same volume.
- **Git.** isomorphic-git over the volume. Clone goes over smart HTTP through the `corsProxy` the clone
  request names, `DEFAULT_GIT_CORS_PROXY` when it names none, and no proxy when it is empty.
- **pi.** `pi-agent-core`'s `Agent` with pi-ai's builtin providers; credentials are API keys entered
  through the ordinary provider login flow, or a Central session for the `jetbrains-ai` provider (`jetbrains.ts`:
  the login takes a Grazie JWT minted in the user's terminal (a hosted page cannot call JetBrains' OAuth endpoint), or a `central login export` where that endpoint allows the origin, spent once and never stored; the credential is a licence JWT good for
  an hour, held in worker memory only (`sessionOnly` keeps it out of `host.json` and OPFS), then a Grazie licence JWT sent as `Grazie-Authenticate-JWT` with no other custom header, as
  Grazie's CORS preflight allows none), kept in the tab. Tools carry pi's names and argument shapes
  (`read`, `write`, `edit`, `ls`, `find`, `grep`, `bash`) so the chat's renderers apply, plus `git_status`,
  `git_commit`, `git_log`. `bash` is just-bash, a simulated shell over the volume (coreutils, rg, sed,
  awk, jq, pipes and redirections) with a `git` command for the everyday subset over isomorphic-git;
  there are no processes, so anything else is "command not found". Every run ends with a synthesized `agent_settled` and a
  `session.state` completion, as the UI's settle edge requires.
- **Terminals.** `terminal.*` is served by a line editor (echo, backspace, Enter, Ctrl+C, Ctrl+L, ↑/↓
  history) in front of a just-bash shell per terminal tab; each command's resulting `PWD` and exports
  carry to the next. Its `git` adds `pull`, `fetch` and `push` over isomorphic-git's HTTP, through the
  `http.corsProxy` a clone records in the repository's config, authenticating with `GIT_USERNAME` /
  `GIT_TOKEN` from the shell's environment.
- **node, npm, npx, tsc.** Shell commands. `node` runs in a nested worker (`runtime/`) on a copy of the
  workspace (plus an `npx` cache root), never in the tab host, so `/.thinkrail` and its credentials stay out
  of reach and a run is terminated after five minutes; files it writes inside those roots are written back
  when it exits. The runtime is CommonJS `require` with Node's resolution (`exports` conditions, `main`,
  index files), ESM and TypeScript converted by sucrase, and builtins from memfs and stand-ins; process,
  socket and native APIs throw. `npm install` resolves semver ranges against the registry
  (`npm_config_registry`, default registry.npmjs.org), hoists, and unpacks tarballs into `node_modules`
  without running install scripts; `npx` runs a local bin or installs into `/tmp/npx`; `tsc` is
  `npx` of the project's or the registry's `typescript`. The first use in a shell prints a risk notice.
- **Deleting the Playground.** The page's `deletePlaygroundData` stops the worker, removes the OPFS
  directory (`TAB_HOST_OPFS_DIRECTORY`), unregisters the file-serving service worker and reloads.
- **One tab owns the volume.** `startTabHost` holds the Web Lock `thinkrail-tab-host` for the worker's
  life; a second tab waits for it, its transport still connecting, because two in-memory copies flushing
  diffs into one OPFS directory would delete each other's files.
- **Plugins.** A plugin whose manifest says `runsInBrowserTab: false` is refused with that reason. Others
  activate against a `PluginHostContext` whose terminal, route and git-CLI capabilities are absent (calls
  throw or report a launch failure) and whose state, settings, tools, methods and channels work as on a
  process host.
