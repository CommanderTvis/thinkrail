---
id: module-cli
type: module-design
status: active
title: CLI launcher + bundled-agent entry
parent: architecture
depends-on: [module-server, module-shared, module-pi-agent, module-acp]
tags: [v1, host]
---

## Responsibility

The V1 entrypoint: the `thinkrail` bin. Boots the engine host in this process and opens the browser UI at
its URL. It is a thin sibling of `apps/desktop`; all host logic and host ownership live in `packages/server`.

The **same bin is also the bundled agent** ([[architecture]] Decision #2): `thinkrail acp-pi` runs
`packages/pi-agent` on stdio, which is how the host starts ThinkRail's own pi agent. One install ships
both halves, and the host spawns the agent by re-invoking this program.

## Flow

1. Parse argv into a subcommand (`src/args.ts`, pure). A leading `acp-pi` / `agent` / `update` /
   `uninstall` is dispatched here and **never reaches the host path** — and no branch's dependencies are
   loaded until it runs, so a `thinkrail acp-pi` child evaluates the agent and never the host.
2. Otherwise parse the launch flags + env into `CliOptions`; `--help` / `--version` print and exit.
3. Resolve the static dir (`THINKRAIL_STATIC_DIR`, else the built web app shipped beside the bin) and
   warn if it's missing.
4. Hand the host the bundled agent's launch spec (`setBundledAgentLaunch`) — see *The bundled agent* —
   **before** `bootHost`, since the first chat may resolve to it.
5. `bootHost()` resolves the login-shell environment (a GUI- or `npx`-launched process must still find
   `git` and the user's tools on PATH — including whatever an installed ACP agent needs), resolves a free
   listen port at or above the requested one (`findFreePort` — `Bun.serve` won't report a busy port), then
   awaits `createServer({ port, host, staticDir, projectPath? })` to embed the host in this Bun process.
6. Resolve the actual port; on interactive stdout render the shared recursive ThinkRail startup mark
   with honest `host ready` status + the resolved endpoint, then retain the stable
   `thinkrail → <url>` line and open the browser there (cross-platform: `open` / `start` / `xdg-open`,
   best-effort), unless `--no-open`. The mark is omitted for redirected output and every exit-only
   command (`--help`, `--version`, and every subcommand).
7. SIGINT / SIGTERM → `bootHost`'s own handlers stop the server (disposing agent processes + PTYs and
   closing the socket), then exit.

## Interface

`bin` = `./src/index.ts` (bun runs the TS source directly). A leading `acp-pi`, `agent`, `update` or
`uninstall` positional is a **subcommand** (`thinkrail agent list | add <id> [--name <n>] --
<command> [args...] | remove <id>`, `thinkrail update [--channel stable|nightly] [--version X.Y.Z]`,
`thinkrail uninstall [--remove-data|--keep-data] [-y]`) intercepted before the launch flags — see the
sections below. The set lives in `args.ts` (`parseSubcommand`) because the compiled
entry needs it too: each subcommand stages a different slice of the embedded assets (the agent needs the
skills, the host needs the web app, `update`/`uninstall` need neither — and `uninstall` must not
re-create the cache it just deleted). Otherwise the launch args: `--port` (stable default 24242,
scans upward to the next free port on collision), `--host` (default `localhost`), `--no-open`,
`--no-analytics` (**per-run mute** for anonymous usage analytics — this run sends nothing; the
durable switch is the app's Settings → Privacy toggle, see `submodule-server-analytics`),
`--verbose` (debug-level logging — threaded to `bootHost` as `verbose: true`; the log files under
`<dataDir>/logs` and their env switch `THINKRAIL_LOG_LEVEL` belong to `submodule-server-log`, whose
module is that variable's single reader — same pattern as `THINKRAIL_NO_ANALYTICS`, so `dev.ts` honors
it too),
`-v`/`--version` (print the baked version and exit), `-h`/`--help`, and one positional `project-dir` (a
git repo to open as a project on boot, best-effort). Env defaults: `THINKRAIL_PORT` / `THINKRAIL_HOST` /
`THINKRAIL_STATIC_DIR` (flag > env > default). `THINKRAIL_NO_ANALYTICS` is documented in `--help` but
deliberately **not** parsed here — the host's analytics module is its single reader (see below).

## The bundled agent (`thinkrail acp-pi`)

`src/acpPi.ts` owns both halves of "this program is also an ACP agent":

- **Running it.** `runBundledAgent()` awaits `@thinkrail/pi-agent`'s `runPiAgentOnStdio()` and returns
  its exit code. The import is **dynamic**, as is every other branch's: a host boot must not evaluate pi,
  and an agent child must not evaluate the host. That is not a size argument (the binary bundles both
  regardless) but an evaluation
  one — the agent process is meant to be one program, and pulling `@thinkrail/server` into it would
  re-run the host's module graph in every chat's child process.
- **Spelling the launch.** `bundledAgentLaunch(build)` is the `AgentLaunchSpec` the host uses to spawn
  that child, installed with `setBundledAgentLaunch` before `bootHost`. `packages/server` deliberately
  does not know it ([[submodule-server-agent]]): the compiled binary is `process.execPath acp-pi`, but in
  a **dev checkout `process.execPath` is `bun`**, so from source it must be
  `bun <abs>/apps/cli/src/index.ts acp-pi`. `launch(build)` already carries that provenance, so the spec
  is derived from it rather than sniffed from Bun's module paths. Getting it wrong is invisible until the
  first chat, which is why the unit test asserts the resolved entry file exists and that the subcommand it
  names is one `parseSubcommand` dispatches.

**stdout is the protocol.** In `acp-pi` the process's stdout carries JSON-RPC frames; anything else
written there is noise the client has to filter. Nothing on this path may print — the startup mark, the
`thinkrail → <url>` line and every progress message belong to the host path, and errors go to stderr,
which the client captures as the crash report's stderr tail.

## Pointing ThinkRail at an installed agent (`thinkrail agent`)

The terminal half of [[architecture]] Decision #20: `list` / `add` / `remove` over the same
`~/.thinkrail/agents` catalog the in-app registry installer writes, so an ACP agent already on the
machine becomes selectable without an install step. `parseAgentArgs` (pure, in `args.ts`) turns
`add <id> [--name <n>] -- <command> [args...]` into an `AgentCatalogEntry`; `src/agents.ts` does the IO
through `@thinkrail/acp`'s `readAgentCatalog` / `recordAgent` / `forgetAgent`.

- **`--` is the separator, and everything after it is the launch command**, stored verbatim. An agent's
  own flags (`--acp=true`) would otherwise be indistinguishable from ours.
- **A registered agent's origin is `external`**, never `installed`: we did not fetch it, we do not own
  its directory, and `forgetAgent` must not delete anything on the way out.
- **`add` does not probe the command.** The host spawns agents with the login-shell PATH
  (`resolveShellEnv`), which this process may not have, so a `which`-style check would reject working
  agents. A wrong command surfaces as `unavailable` on the agent's first use, where the error is real.
- **The bundled id is refused** rather than shadowed — the host drops a catalog row claiming it, so an
  accepted `add` would silently do nothing.
- The catalog path and the bundled id come from `@thinkrail/server` (`agentsDir`, `BUNDLED_AGENT_ID`)
  for the same reason `uninstall` takes `dataDir` from there: a launcher that spells host state itself
  eventually spells it differently.

## Self-update (`thinkrail update`)

`src/update.ts` ports the old repo's `thinkrail upgrade` (renamed): it re-invokes the **published
installer** for the binary's channel — `install.sh` on macOS/Linux, `install.ps1` on Windows — so the
installer stays the single source of the download → checksum → replace → PATH logic. Channel/prefix
resolve the same way on both: flag > `~/.config/thinkrail/install.json` > baked channel (from
`version.ts`; `dev` → `stable`) / `~/.local`.

- **Unix:** `curl` the script, feed it to `bash -s -- --channel … --prefix … [--version …]`.
- **Windows:** fetch `install.ps1`, write it to a temp `.ps1`, and run it through the first available
  PowerShell host (`powershell.exe`, else `pwsh.exe`) as
  `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File <tmp> -Channel … -Version … -Prefix …`.
  `-File` (not `irm | iex`, which needs a shell to pipe through, and not `-Command`, whose quoting is a
  minefield) hands the installer's own params through argv. All three params are passed **always**,
  including `-Version latest`: install.ps1's params *default from the `THINKRAIL_*` env vars*, which the
  child would inherit, so being explicit is what makes an update deterministic for a user who has one
  set. Replacing the *running* exe works because install.ps1's `Install-ThinkRailBinary` renames a locked
  `thinkrail.exe` aside to `thinkrail.exe.<rand>.old` (Windows refuses to *delete* a running image but
  permits *renaming* it) and drops the fresh one in; the next install sweeps the leftover.

Any Windows failure (fetch, no PowerShell host, installer non-zero) falls back to *printing* the manual
per-shell command (`windowsManualUpdateMessage`) with the releases page under it: cmd's `set "X=v" &&`
and PowerShell's `$env:X='v';` are not interchangeable — one shell's syntax shown to the other silently
re-installs the wrong build, and a dropped `THINKRAIL_PREFIX` would put a second copy under `.local`
while the PATH-resolved exe stays stale. `resolveWindowsPrefix` owns that seam for the message (it omits
the installer's own default as noise); `resolveWindowsInstallPrefix` is the same validation for the
executed plan, and both refuse a metadata prefix that isn't a rooted Windows path or can't be safely
quoted (Windows needs its own charset — `PREFIX_FORBIDDEN_RE` rejects the backslash every Windows path is
made of). The arg parse + channel/prefix resolution are pure (`parseUpdateArgs` / `resolveUpdateChannel` /
`resolveWindowsPrefix` / `resolveUpdatePlan` / `resolveWindowsUpdatePlan`, unit-tested); only fetch
(`curl` / `fetch`) + run (`bash -s` / `powershell -File`) touch IO.
`THINKRAIL_INSTALL_SCRIPT_URL` / `THINKRAIL_INSTALL_PS1_URL` override the installer URLs (testing /
forks). See `module-ci-release` for the installers themselves.

## Uninstall (`thinkrail uninstall`)

`src/uninstall.ts` is the inverse of the installers, and only of them: it removes **the executable, the
PATH edit the installer made, `install.json`, and the binary's staging cache** — then *asks* about the
user's app state (the data dir), which is **kept by default** because it holds the workspace git
worktrees and any uncommitted work in them. pi's own state (`~/.pi`) is never touched: it is not ours.

- **Plan, then confirm, then act.** `resolveUninstallTargets` is pure (platform + home + install
  metadata + `process.execPath` → the paths); an inspection pass narrows it to what actually exists (and
  which rc files really carry the installer's block) so the printed plan is *true*; then the prompts;
  then the removals, each reported as `removed` / `kept` / `not found` / `failed` (any `failed` → exit 1).
- **Prompts** (`node:readline/promises`): the data-dir question (default *keep*), then a final confirm.
  `-y`/`--yes` skips both and `--keep-data`/`--remove-data` answers the first one non-interactively; with
  no TTY and no `--yes` the command refuses rather than guessing.
- **Which executables:** `<prefix>/bin/thinkrail[.exe]` from the install metadata (else the installers'
  `~/.local` default) **plus `process.execPath` when it is itself a `thinkrail` binary** — that covers a
  custom prefix whose `install.json` is gone. Nothing else is ever deleted, whatever the metadata says.
- **The PATH edit, per platform seam:** on Unix the installer's block is *self-identifying*
  (`# >>> thinkrail PATH >>>` … `# <<< thinkrail PATH <<<`), so `stripRcPathBlock` removes it from every
  candidate rc file that carries it (bash/zsh/`$ZDOTDIR`/`.profile`, and the fish `conf.d` file is
  deleted when nothing but the block was in it) — and refuses to touch a file whose block has no end
  marker rather than truncating it. On Windows the registry entry is *opaque* (nothing marks it as ours),
  so install.ps1 **records whether it added the entry** (`install.json`'s `path_entry_added`, sticky across
  re-installs of the same prefix — an update sees `already` precisely because an earlier run of ours added
  it) and the uninstaller removes it **only for that flag, and only for the prefix it was recorded
  against**. Being installed is not the same as having added the entry: `-NoModifyPath`, an entry that was
  already present, a failed registry write and a Git-Bash `install.sh` install all record an install
  without touching the Windows PATH, and legacy metadata predates the flag — all of those are *not ours*,
  so the PATH is left alone and the user is told which dir to check. The edit itself runs as an embedded PowerShell script —
  the exact inverse of install.ps1's `Add-ThinkRailToUserPath` (same `HKCU\Environment` handling,
  preserving the value's `REG_EXPAND_SZ` kind, comparing entries raw *and* `%VAR%`-expanded, then
  broadcasting `WM_SETTINGCHANGE`) — because round-tripping a raw PATH value through a pipe would risk
  mangling non-ASCII entries in the console code page.
- **Deleting the running program:** Unix unlinks a running binary happily. Windows cannot, so the exe is
  renamed to the same `thinkrail.exe.<rand>.old` name install.ps1's cleanup already recognizes, and a
  detached PowerShell retries the delete for a few seconds after we exit; the report says which happened.
  Stale `.old`/`.new` leftovers in the bin dir are swept too.
- `src/powershell.ts` is the shared seam for both Windows paths (find a host, run a script text through
  it, `psQuote` a value into a single-quoted literal). `src/paths.ts` owns the *installed* layout —
  `install.json` (read by `update` + `uninstall`) and the staging cache root (written by
  `compiled-entry`, deleted by `uninstall`) — so those three agree by construction.

## Version stamping (release seam)

`@thinkrail/shared/version` exports `{ version, channel, commit }` with a permanent from-source default
(`0.0.0-dev`). The release pipeline overwrites that one module in the throwaway CI checkout before
building CLI and desktop, so both report identical identity. There is no analytics-key seam here.
`bootstrap.ts` prints the shared version for `--version`, passes it into `bootHost` for
`server.welcome.appVersion`, and threads `{ channel, build: "binary" | "source", mute }` into analytics.

## Launch entries + build provenance

`src/bootstrap.ts` owns the launch sequence (argv → subcommand or host boot → open browser) and exports
`launch(build: BuildKind)`, which carries the single error-exit path. The two entries differ *only* in the
provenance they declare, and each knows its own by construction rather than by inspecting the runtime:

- `src/index.ts` — the `bin`, i.e. run **from source**: `launch("source")`.
- `src/compiled-entry.ts` — the **compiled binary**'s entry (per-role staging first):
  `launch("binary")`.

`build` is more than an analytics label now: it is also what tells `bundledAgentLaunch` how this program
re-invokes itself as an agent, which is why the provenance stays declared rather than detected.
`build` rides analytics as a plain property, so `channel = dev` runs are still separable into a locally
compiled binary vs a source run (see `submodule-server-analytics`). Deliberately *not* sniffed from Bun's
`/$bunfs/` module paths: that's an implementation detail a Bun bump can change, and it would mislabel
silently. `src/args.ts` parses `--no-analytics` into `CliOptions.noAnalytics` but does **not** read
`THINKRAIL_NO_ANALYTICS` — the host's analytics module is that variable's single reader, so every
entrypoint honors it (including `packages/server/src/dev.ts`, which parses no argv).

## Single-file binary (`build:binary`)

`bun run build:binary` produces a **standalone `thinkrail` executable** — one self-contained file per
platform — via `bun build --compile`. One artifact carries **both roles**: the host and, under `acp-pi`,
the bundled agent, which is what makes `process.execPath acp-pi` a complete spawn. Bun bundles both *and*
transparently embeds the `bun-pty` native lib; the extra steps are the **web UI** (a directory the host
normally serves), the **bundled pi extensions** (which the agent path-loads out of `node_modules` in dev —
impossible inside a binary), and `trash`'s **native helper sidecars** (which macOS/Windows must execute
from real filesystem paths):

- `scripts/build-binary.ts` consumes `@thinkrail/server/build-support`, writes three **transient** generated modules, runs
  `bun build --compile --no-compile-autoload-bunfig --target=<host|--target>` on
  `src/compiled-entry.ts`, then deletes them (so the artifact cannot execute a project-local
  `bunfig.toml` preload before ThinkRail boots, and the working tree + `tsc` stay clean); each generated
  module has a committed `.d.ts` type contract `tsc` resolves against
  when the `.ts` is absent:
  - `src/web-assets.generated.ts` — enumerates `apps/web/dist`: a Bun file-attribute import per asset +
    a `{ route, data }[]` manifest + a content-hash version.
  - `src/bundled-extensions.generated.ts` — **value-imports the five bundled extension entries**
    (`pi-web-access`, `pi-visualize`, `pi-spec-graph`, `pi-thinkrail-workflow`, `pi-todos`), resolved from
    the **`pi-agent` package's** module context (absolute paths — they aren't deps of `cli`, and they
    stopped being deps of `server` when the engine moved), so Bun compiles the
    raw `.ts` and their real deps (`yaml`, `linkedom`, `unpdf`, …) into the binary; plus the
    `pi-spec-graph`/`pi-thinkrail-workflow`/`pi-todos` `skills/` files embedded like web assets (matching what dev
    wires via `additionalSkillPaths` — parity, not a superset). Its `.d.ts` types the factories via
    `@thinkrail/pi-agent`'s exported `BundledExtensionFactory`, so `cli` still never imports
    `@earendil-works/pi-coding-agent`.
  - `src/runtime-assets.generated.ts` — embeds `trash`'s `macos-trash` and `windows-trash.exe` helper
    binaries, resolved from the server package's dependency context (trash stayed with the host), as a
    content-hashed manifest.
- `src/compiled-entry.ts` is the binary's entry, and it stages **per role** — the agent child pays for the
  skills, the host pays for the web app, and neither pays for the other's:
  - `acp-pi` → stage the skills, then **await `@thinkrail/pi-agent`'s `registerBundledRuntime`**, which
    injects the extension factories + staged skills dir **and** performs pi's binary-only registrations
    (the statically-bundled OAuth flows + the Bedrock provider module, replacing pi's binary-hostile
    dynamic imports — see [[module-pi-agent]]).
  - no subcommand → stage the web app + the trash helpers, make the macOS helper executable, set
    `THINKRAIL_STATIC_DIR`, and hand the real helper paths to the host with `setBundledTrashHelpers`
    (delete-to-trash is the host's, and the `trash` package's own sidecar paths do not exist in a binary).
  - `update` / `uninstall` → nothing.

  Staging writes to per-build cache dirs (`$XDG_CACHE_HOME`/`~/.cache`/temp; files written straight into
  the versioned dir, then a sibling `<dir>.complete` marker written **last** — readiness is gated on the
  marker, so a killed first run leaves an incomplete cache that's re-extracted next launch. **No
  stage-then-rename**: Bun's `renameSync` of a fresh non-empty dir `EPERM`s on Windows, so the marker
  replaces the directory-rename publish). Then it hands off to `bootstrap`. (`bun-pty` self-extracts
  automatically; **no photon wasm** — the agent's read tool is set to send images raw, agent-side.
  Skills must be staged to the *real* filesystem: pi reads `SKILL.md` via plain fs and embeds the path in
  the system prompt.)
- Cross-compile with `--target=bun-darwin-arm64|bun-linux-x64|bun-windows-x64|…`; each bundles that
  platform's matching `bun-pty` lib. The binary is platform-specific and self-extracts a few MB on first run.
- **Verify by booting the artifact** (not just building it): extension wiring regressions surface only at
  runtime — e.g. path-loading broke silently for every extension added after the binary build first landed.
  `scripts/smoke-binary.ts` (root: `bun run smoke:binary`, after `build:binary`) boots the built binary
  against throwaway data/agent/cache dirs. Its CLI adapter runs the shared
  `@thinkrail/server/artifact-probes` host assertions also used by desktop; CLI-only assertions additionally
  prove the staged-cache and command-line shape. Together they assert: a project-local `bunfig.toml` preload does **not**
  execute, **`thinkrail acp-pi` answers an ACP `initialize` on stdio** with no `pi` executable on `PATH`,
  under both the default and a custom `PI_CODING_AGENT_DIR` — the artifact-only regression class, since
  that one exchange proves the bundled agent spawns, its extension factories register and pi's dynamic
  imports resolve inside the binary (`compiled-entry.ts` stages the skills dir and calls
  `registerBundledRuntime` before the ACP connection opens, so a broken bundler-opaque import fails right
  here) — then, against the full host, `/health` answers, `/` serves the staged UI, the bundled workflow
  skills staged to the cache dir (the same `XDG_CACHE_HOME` the two `acp-pi` legs used, so their staging
  is what this glob checks), **moves a seeded transcript through `session.delete` into the OS trash**
  (pinning the static `processMountinfo` parser inclusion that `trash`'s Linux implementation otherwise
  reaches through a binary-opaque CommonJS require; the fixture is seeded at the **host-reported
  `worktreePath`**, never the smoke's own temp path, because the host stores git's symlink-resolved root
  — macOS `/var` → `/private/var`, Windows' 8.3 `TEMP` — so a fixture written at an unresolved path lands
  in an encoded session dir the host never scans, and the delete then truthfully no-ops while the file
  stays put), verifies both macOS/Windows trash helpers were staged from the artifact, and SIGTERM exits
  0. CI builds + smokes the binary on every PR on **ubuntu and windows** (each its host target); macOS
  binary coverage stays release-matrix-only. What it can't cover: a live prompt turn against a real
  provider (that's `e2e:agent` territory, run-from-source), and skill/resource discovery over ACP, which
  has no wire surface yet at all (host/SPEC.md's "Four methods answer honestly" — `skill.list` is an
  intentional stub, so the smoke does not call it). The smoke's **broad-net sibling** is `bun run
  e2e:binary` (root `playwright.binary.config.ts`): the whole no-agent e2e suite executed against this
  binary — also in CI on every PR. And `bun run check:seams` (root `scripts/check-binary-seams.ts`) is
  the build-time canary for the seam class: it fails when a pi bump introduces a new bundler-opaque
  dynamic import that `packages/pi-agent`'s `registerBundledRuntime` doesn't statically register.
- **The smoke's fixtures are host-OS-shaped, not POSIX-shaped.** Every one of them was a Windows failure
  in a green-on-Linux suite:
  - The **pi-free `PATH` is derived from the live `PATH`** by dropping the entries that hold a `pi`
    executable — never a hardcoded `/usr/bin:/bin` skeleton, which on Windows leaves the host without
    `git.exe` or System32 (`project.open` shells out to bare `git`). The smoke asserts no `pi` is
    reachable, and additionally that `git` survived the filter.
  - **`HOME` *and* `USERPROFILE` point at the smoke's temp home** in every spawned process, because
    `homedir()` — which pi's `getAgentDir()` uses — reads `USERPROFILE` on Windows and ignores `HOME`.
    Without it the default-agent-dir `acp-pi` leg writes into the runner's (or a Windows developer's) real
    `%USERPROFILE%\.pi\agent` instead of the sandbox.
  - **Every spawned process's env is built by `hostEnv`, which drops the inherited case-variants of the
    keys it overrides.** Windows env names are case-insensitive and the runner's is spelled `Path`, so the
    familiar `{...process.env, PATH: x}` ships *both* keys and the child reads the inherited one — a
    process launched that way silently keeps running with the machine's real PATH.
  - **The fixture project's seed commit disables GPG/SSH signing** (`-c commit.gpgsign=false`): it is a
    throwaway `/tmp` repo the smoke deletes on exit, not a commit anyone reads, and it must not depend on
    whatever signing key the machine running the smoke happens to have configured or unlocked.

## Boundary

- **Owns:** `src/args.ts` (the pure argv layer: `parseArgs(argv, env) → CliOptions`, `parseSubcommand`,
  `parseAgentArgs`, `USAGE` + `AGENT_USAGE`), `src/bootstrap.ts` (subcommand dispatch → host boot →
  browser open) behind the two provenance entries `src/index.ts` (source) and `src/compiled-entry.ts`
  (binary), `src/acpPi.ts` (the bundled agent: running it, and the launch spec the host spawns it with),
  `src/agents.ts` (the `agent` subcommand's catalog IO),
  and the binary build + its boot smoke (`scripts/build-binary.ts`, `scripts/smoke-binary.ts`,
  `scripts/artifactName.ts` — the one place the artifact filename rule lives, including the `.exe` Bun
  appends for a Windows target, so the build's output path and the smoke's default input cannot disagree
  the way they did on Windows; the release action re-derives the same name in bash because it is also the
  published-asset contract, see `module-ci-release`),
  `src/web-assets.generated.*`, `src/bundled-extensions.generated.*`,
  `src/runtime-assets.generated.*`),
  `src/update.ts` (the `update`
  subcommand), `src/uninstall.ts` (the `uninstall` subcommand), `src/paths.ts` (the installed layout:
  `install.json` + the staging cache root), and `src/powershell.ts` (the Windows PowerShell seam). Central
  integration remains a server/auth feature; the launcher has no Central subcommand or protocol implementation.
- **Allowed deps:** `@thinkrail/server`'s **root barrel only** — `bootHost` / `createServer`, plus the
  pre-boot seam it exists to serve (`setBundledAgentLaunch`, `setBundledTrashHelpers`) and the host-state
  names a launcher must not respell (`dataDir` for the uninstaller, `agentsDir` + `BUNDLED_AGENT_ID` for
  `thinkrail agent`) — plus the test-only `transcript-test-fixtures` subpath in the artifact smoke to seed
  a real host transcript; `@thinkrail/pi-agent` (`runPiAgentOnStdio`, `registerBundledRuntime`,
  `BundledExtensionFactory` — the bundled-agent role, dynamically imported so the host path never
  evaluates pi); `@thinkrail/acp` for the agent catalog only (`AgentLaunchSpec`, `AgentCatalogEntry`,
  `readAgentCatalog` / `recordAgent` / `forgetAgent`) — never a protocol call, which is `server`'s;
  `@thinkrail/shared/shellEnv` (`resolveShellEnv`) + `@thinkrail/server`'s build-support and artifact-probe subpaths; `@thinkrail/shared/startupMark` (the shared boot
  signature renderer), Bun/Node; the generated build module may
  value-import the bundled extension packages' entries (resolved via the pi-agent package — build-time
  only, deleted after compile).
- **Forbidden:** the `@thinkrail/server/agent` subpath and every other server internal (the root barrel is
  the whole surface), the browser/`contracts` UI layer, `@earendil-works/*` and `@agentclientprotocol/*`
  directly — the two roles reach pi and ACP only through `@thinkrail/pi-agent` and `@thinkrail/acp`.

## Get right

- A stable default port is friendlier than `port:0` for a CLI you re-run, but you must know the resolved
  port to open the URL — so scan upward from the requested port to the first free one, then open the
  resolved origin. (`Bun.serve` won't surface `EADDRINUSE` for a busy port, so the free port is found by
  probing, not by catching a bind error — see `@thinkrail/shared/freePort`.)
- The browser is the V1 client, not a fallback — the same UI can point at a remote host (the V2 path).
- Agents are **separate processes** this program spawns ([[architecture]] Decision #13), including the
  bundled one — a fatal agent fault is a supervised child dying, not the app going down.
- The launch spec must be right for the *provenance*, not for the machine: `process.execPath` is the
  ThinkRail binary when compiled and `bun` from source, and only `launch(build)` knows which.
- Under `acp-pi`, stdout belongs to the protocol — never print on that path.
- `resolveShellEnv()` runs once, before any agent is spawned.
- The startup mark is a presentation of the resolved launch result, never a second readiness signal:
  `bootHost` must return first, and the parse-stable `thinkrail → <url>` line remains unchanged beneath it.

## Later

A headless `serve` mode (always-on host for remote/automations, V2). The shipped desktop sibling swaps
"open a browser" for "open a native webview" over the same `bootHost()` lifecycle.
