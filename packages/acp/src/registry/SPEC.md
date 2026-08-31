---
id: submodule-acp-registry
type: submodule-design
status: draft
title: registry — the ACP agent registry and installed catalog
parent: module-acp
depends-on: [module-contracts]
covers: [agent-registry, agent-detection]
tags: [v1, acp]
---

## Responsibility

The published ACP agent registry, platform resolution from a registry entry to a launch spec, the
catalog of agents ThinkRail knows how to start (Decisions #12 and #20), and the **curated detection
pass** that answers "which of these does this machine already have?".

## Boundary

- **Owns:** the defensive registry parser, the ordered platform-key resolution, the `InstallPlan`,
  `<agentsDir>/agents.json` — which holds both registry-installed agents and the terminal-native
  "point me at this binary" entries in one list — and the detection shortlist plus the probe that
  answers it.
- **Public surface (barrel):** `ACP_REGISTRY_URL`, `fetchRegistry`, `parseRegistryDocument`,
  `platformCandidates`, `planInstall`, `markInstalled`, `readAgentCatalog`, `recordAgent`,
  `forgetAgent`, `detectAgents`, `DETECTION_SHORTLIST`, `systemProbe`, `InstallPlan`,
  `InstallDownload`, `AgentCatalogEntry`, `FetchLike`, `RegistryFetchResult`, `DetectAgentsOptions`,
  `DetectionProbe`, `DetectionQuery`.
- **Allowed deps:** `@thinkrail/contracts` (`AgentRegistryEntry`, `AgentDistribution`,
  `DetectedAgent`), `fetch` (injectable), `node:fs/promises`, `node:os`, `node:path`; type-only
  `AgentLaunchSpec` from `connection`.
- **Forbidden:** the ACP SDK; siblings `translate`, `client`, `meta`; the host. **The data directory is a
  parameter** — this module never derives `~/.thinkrail` itself.

## Decisions

- **Some registry rows carry ThinkRail's own caution.** `markInstalled` stamps `notRecommended` onto
  entries in the `DISCOURAGED` table, and the picker renders that reason beside the row instead of
  presenting the entry as a neutral choice. `pi-acp` is the standing case: ThinkRail ships its own pi
  agent, and [[architecture]] Decision #14 records why that adapter was rejected on facts — it discards
  `session/new`'s `mcpServers`, closes every other session on `session/new` and `session/load`, and
  delegates neither `fs/*` nor `terminal/*`. Installing it silently costs a user the tools and
  concurrent chats, so the row states that rather than letting them find out afterwards. The entry stays
  installable: this is a caution the user can overrule, not a block.

- **The wire types are `contracts`'.** This module produces `AgentRegistryEntry` / `AgentDistribution`
  directly; its own local types are only `AgentCatalogEntry` (the on-disk record) and `InstallPlan`.
  There is deliberately no second `InstalledAgent`/`RegistryEntry` pair — a name that exists in both
  `contracts` and this barrel is a collision waiting to be imported wrong.
- **Resolve and record; do not download.** Producing an `InstallPlan` (archive URL, target dir, resulting
  launch spec) keeps tar/zip and network *writes* in the host, where a progress UI and a data directory
  already live. The plan is ordered: fetch and unpack `download` first — it is `null` for an `npx`/`uvx`
  distribution, where there is nothing to fetch, and its `dir` is absolute — then hand `entry` to
  `recordAgent`, which replaces by id, which is how an upgrade lands.
- **`AgentCatalogEntry.dir` is what removing the agent deletes**, and only an archive install has one:
  an `npx` install, an external agent and a bundled one own no directory, so forgetting one removes a
  row and nothing else. `origin` is the only thing separating a registry install from a terminal-native
  "point me at this binary" entry.
- **A native build beats a runner.** `npx` and `uvx` are platform-independent and win only when no
  `binary` build matches this machine, because a native binary starts without a package manager in the
  path. An entry that publishes nothing usable here resolves to a `null` distribution that is carried
  through rather than dropped, so the row renders as unavailable instead of vanishing.
- **`installed` is the caller's answer, never the parser's.** `parseRegistryDocument` always emits
  `false` — it does not read the catalog — and `markInstalled` folds the local catalog in afterwards, so
  one row can say "installed", "update available" or "install".
- **Platform keys are `{darwin,linux,windows}-{aarch64,x86_64}`**, verified against the live document:
  every published `distribution.binary` uses exactly that vocabulary, with no `arm64` / `x64` /
  `macos` / `win32` spellings anywhere. Resolution maps Node's `process.platform` + `process.arch` to
  the canonical key and tries a short alias list after it, so a future spelling degrades to a miss
  rather than a crash; an unmatched platform is a clean "not available for your machine".
- **A bad entry is skipped, never thrown on** — one malformed record must not empty the install picker.
  A failed fetch serves the cache with `stale: true`, which is a list to render rather than a verdict
  that a missing agent is gone. The on-disk catalog is read the same way: a damaged or hand-edited
  `agents.json` yields whatever entries still parse rather than an empty picker or a boot failure — the
  catalog is a convenience, and the bundled agent is reachable without it.
- **Three distribution kinds, because the registry publishes three:** `npx` (21 entries), `binary`
  (17) and `uvx` (2). All three carry an optional `args` and `env`. A distribution matching none of
  them is skipped, not guessed at.
- **`npx` / `uvx` distributions pin `pkg@version` straight from the entry.** Decision #10's exact-pin
  rule applies hardest to a dependency the lockfile cannot reach, which is the whole reason #20
  installs into our own directory.
- **Archive integrity is checked when the registry offers it.** About half the published builds carry a
  `sha256` for their archive; `InstallDownload.sha256` passes it through and the host must verify before
  unpacking. When an entry omits it the install is reproducible by URL and version but not verifiable —
  so the host records the hash it observed, and a later reinstall that disagrees is a hard failure.

## Detection: the curated shortlist

`detectAgents` answers one product question — *"the user already has Junie somewhere; make adding it
one click"* — and nothing more. It is not a survey of the registry.

- **A curated shortlist, not a sweep of all ~39 published agents.** Probing every entry costs a
  filesystem walk per agent for a list nobody reads, and most of the registry is a niche or vendor-
  internal agent a user would never recognise in a "found on this machine" list. `DETECTION_SHORTLIST`
  is **`junie`, `claude-acp`, `codex-acp`, `gemini`, `github-copilot-cli`, `cursor`, `opencode`,
  `goose`** — Junie because it is the sketch's worked example and the launch-matrix partner
  ([[architecture]] Decision #13), then the six coding agents whose CLI a developer is most likely to
  already have on PATH, each **published first-party by its own vendor** in the live document. Every id
  here is copied from `cdn.agentclientprotocol.com`, never guessed, and
  `registry.fixture.json` carries the real entry for each one so a renamed or withdrawn id fails a
  test rather than silently detecting nothing. Deliberately out: `pi-acp` (rejected on facts,
  [[architecture]] Decision #14 — ThinkRail ships its own pi agent), community re-wrappers of a vendor
  CLI (`amp-acp`), and everything else the registry publishes, which reaches the user through the
  install picker instead.
- **The shortlist is an ordering, not a gate.** `detectAgents` takes it as a parameter with the
  constant as default, so a test names its own and a future settings switch could widen it without
  touching this module.
- **The probe is one injectable function.** `DetectionProbe` answers two queries — *does this command
  resolve here* and *is this runner's package already present globally* — and returns the absolute
  executable to launch, or `null`. `systemProbe` is the real default; every unit test passes a fake, so
  detection tests touch neither the filesystem nor the network.
- **`binary` → PATH, `npx`/`uvx` → runner *and* an existing global install.** A registry `binary`
  distribution names an archive-relative `cmd`, so detection strips the directories and any
  `.exe`/`.cmd`/`.bat`/`.ps1` launcher suffix and looks the bare name up on `PATH` plus the usual
  user-local bin dirs (`~/.local/bin`, `~/bin`, `~/.bun/bin`, `~/.cargo/bin`, `~/.npm-global/bin`, both
  JetBrains Toolbox `scripts` dirs, `/usr/local/bin`, `/opt/homebrew/bin`). A runner distribution
  requires **both** the runner and the package already in a global `node_modules` / uv tools dir:
  `npx -y pkg@version` alone would cheerfully download the package, which is the opposite of "the user
  already has it". The command name is always **derived from the registry entry**, never a hardcoded
  per-agent guess.
- **Detected is not installed.** An id already in `<agentsDir>/agents.json` is dropped before it is
  probed — it belongs to `agent.list`, not to a one-click add row — and so is a shortlisted id the
  registry no longer publishes. Nothing that fails to resolve is returned at all: what the machine
  cannot do is **absent**, matching the capability rule the rest of the UI obeys.
- **A `DetectedAgent` carries no version and no `env`.** The registry's version describes the archive
  it would have installed, not the binary that happens to be on this PATH, so reporting it would be a
  guess rendered as a fact. A distribution that declares `env` is skipped rather than half-detected:
  the one-click add path (`agent.add`) carries `{id, name, command, args}` and nothing else, and an
  agent that needs environment to start belongs in the install flow, which does carry it.
