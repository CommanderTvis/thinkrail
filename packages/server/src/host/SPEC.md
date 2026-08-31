---
id: submodule-server-host
type: submodule-design
status: active
title: host — the browser↔host wire
parent: module-server
depends-on: [module-contracts, module-acp]
references: [architecture, submodule-server-agent, submodule-server-transcript]
tags: [v1, host, acp]
---

## Responsibility

The wire and the composition root: `Bun.serve` HTTP+WS, static SPA serving, the WS method→handler
registry, channel fan-out, and the process-boot wrapper both launchers share. Every seam a feature module
exposes is installed here, and every cross-feature composition happens here — features never reach back.

## Files

| file | owns |
| --- | --- |
| `server.ts` | `createServer`: `Bun.serve`, the channels, every publisher seam, `server.welcome`, `stop()` |
| `boot.ts` | `bootHost`: `initLogging` → crash report → login-shell PATH → free port → `createServer` → signal handlers |
| `handlers.ts` | the WS method→handler registry (one entry per `WS_METHODS` name) |
| `agentInstall.ts` | the ACP registry read + the install-a-plan flow behind `agent.registry` / `agent.install` |
| `agentCatalog.ts` | `agent.add` / `agent.remove` / `agent.detect` over the installed catalog, and the one `agent.changed` publisher every catalog mutation goes through |
| `agentCredentials.ts` | the `AgentCredentials` resolver: adapts `agent`'s credential methods, opens the sign-in terminal |
| `autoRename.ts` | the workspace naming tee off the chat event stream |
| `historyScope.ts` | `HistoryScope` → the `includes` / `projectOf` predicates `history` searches with |
| `reviewLock.ts` | the per-workspace serialization every review mutation and send runs under |
| `requestReplayCache.ts` | exactly-once request replay across a reconnect |
| `crashLog.ts` | the `uncaughtException` / `unhandledRejection` report under `<dataDir>/logs`, rendered through `log`'s `describeError` but appended synchronously — the death path must not depend on the logger's state |
| `fsNudge.ts` | the pathless `fsChanged` frame a moved base ref fans out |
| `terminalSend.ts` | the send-status → delivery classification the terminal publisher uses |

## The wire

- **`/health`**, the **`/ws`** upgrade (the `?client=` page identity read off the socket URL and threaded
  to every handler as `RequestContext`), **`GET /files/<workspaceId>/<relpath>`** streaming a worktree
  file's raw bytes through `fs`'s `resolveWorktreeFile` (path-contained; bad id / escape / miss → 404) so
  the markdown viewer's relative `<img>`s resolve, and static serving with `index.html` fallback.
- **`server.welcome`** carries **two versions**, per [[architecture]] Decision #3: ThinkRail's
  `PROTOCOL_VERSION`, so an independently-shipped UI can detect host drift, and the **ACP protocol
  version negotiated with the default agent**, so a capability gap can be attributed to the agent rather
  than the host. The second is `null` until that agent has actually connected — the host does not guess a
  version for a process it has not spoken to. `defaultAgent` is the descriptor `AppConfig.defaultAgentId`
  resolves to (bundled when unset), refreshed whenever settings change or Central reconfigures, so the
  welcome never advertises an agent the catalog no longer holds.
- **WS commands return values directly.** Only events and lifecycle pushes use channels, and **every
  broadcast channel a client should hear is `ws.subscribe`d in the WS `open` handler** — a publish on an
  unsubscribed topic reaches nobody, silently. `BROADCAST_CHANNELS` is that one list; adding a channel
  means adding it there. The three terminal channels are deliberately **not** in it: they are `ws.send`
  to the single attached client (see [[submodule-server-terminal]]).
- **The request replay cache** is keyed by `(clientKey, requestId)`: the first frame owns one handler
  promise plus its serialized response, a reconnect replay awaits and returns that same result, and a
  mismatched duplicate is rejected. Reaping a client clears its cache — **but only once nothing is in
  flight**: an unresolved request outlives the socket grace window, since the page holds that frame until
  its own deadline and replays it on reconnect, so `clearClient` declines and the reap re-arms rather than
  letting the replay start a second execution of a handler that has not finished. **Nothing is evicted on
  the host's own initiative**, because a successful `send` says the bytes were queued, not that the page
  read them. A result leaves only on the client's word, via two frames handled here and never routed to a
  handler: `{ ack: [id] }` names responses it has **read**, and `{ resume: [id] }` on each reconnect names
  everything it still considers **unresolved**, freeing all other settled results. `resume` is what makes
  receipts safe to lose — an ack can die in a socket buffer exactly like a response can. Cost is bounded
  instead by two hard limits, each enforced where its size becomes known: the entry count on the way *in*
  (a full namespace refuses new ids while still answering every id it holds) and the retained bytes on the
  way *out* of the handler (a response's size is unknowable at admission — `fs.readFile` returns a whole
  file). A result that would breach the byte budget is not retained: the entry stays as proof the work
  ran, so its replay fails rather than re-executing, and the response the caller already got is
  unaffected.

## What the composition root wires

- **The agent's four channels** (`setAgentPublishers`): `chat.event`, `agent.permission`,
  `agent.elicitation`, `session.deleted`. The chat publisher is also the **tee** two host-owned flows hang
  off — see below — and `disposeAgentSessions()` runs in `stop()` and in the signal handler.
- **`auth`'s credential resolver** (`agentCredentials.ts`, `setAgentCredentials` — bound before a socket
  is opened, per this module's Public surface): a plain `AgentCredentials` object per agent id, adapting
  `agent`'s six credential methods ([[submodule-server-agent]]) with no `@thinkrail/acp` type in reach —
  `authenticate`'s `terminal` outcome is the one case that needs more than a straight call-through, and it
  is composed here because opening a real terminal touches two more modules (`terminal`, and
  `projects`/`workspaces` to find one to open it in) that neither `agent` nor `auth` may reach.
  **Design call: which workspace hosts a sign-in terminal, when authentication can happen before any
  workspace is open.** The wire's `agent.authenticate` carries only `{ agentId, methodId, env? }` — no
  workspace, because the Welcome banner and the Settings dialog that trigger it are both global, not
  workspace-scoped — so this module picks the **first workspace of the first known project**
  (`firstOpenWorkspace`, `listProjects()` then that project's own `listWorkspaces`, which lazily creates
  the Default workspace if the project has none yet). A project with at least one workspace always
  resolves; a host with **no project open at all** fails the authenticate with a message asking for one,
  rather than crashing or fabricating a workspace id `terminal`'s `spawnForTab` would reject anyway.
  `apps/web`'s `AgentProviderSetup.tsx` already renders this honestly: it navigates to the
  returned `workspaceId` when it knows it, and otherwise names it in a toast — built that way before this
  resolver existed, which is why no UI change accompanies it.
- **The agent-catalog publisher** (`agentCatalog.ts`, `setAgentCatalogPublisher`): one seam every
  mutation of `<agentsDir>/agents.json` — `agent.install`, `agent.add`, `agent.remove` — calls, which
  refreshes `server.welcome`'s `defaultAgent` and broadcasts the data-free `agent.changed`. Wiring it
  once here is what keeps "the list changed" from being three copies of a broadcast, and matches the
  `jbcentral` changed seam it sits beside. `agentCatalog.ts` never imports `agentInstall.ts`: the
  registry entries `agent.detect` needs are read by `listRegistry` and passed in by the handler, so
  the two files stay a one-way edge.
- **Project / workspace / settings / layout / review / terminal-tabs lifecycle publishers**, each mapping
  a feature's domain event onto its channel. The project and workspace channels carry **full snapshots**,
  so they are idempotent and converge every client (including the initiator) by reaction rather than
  optimism.
- **The fs-watch fan-out**: `setWatchPublisher` publishes `workspace.fsChanged` and re-anchors the
  workspace's review in the same pass; `setRepoMetaPublisher` additionally re-syncs a user-owned
  workspace's folder-truth branch and emits a pathless, skill-neutral frame so every client's
  `HEAD`-relative read (`git.status`, an `uncommitted`-scope diff tab) re-reads when a terminal
  `commit`/`reset` moves a ref. `fsNudge.ts` fans the same pathless frame to each workspace whose diff base
  is a remote-tracking ref the app's own background fetch just **moved** — a write only the project repo's
  shared `.git` sees, invisible to every worktree watcher. `ensureWatch(workspaceId)` is called from the
  workspace-read handlers (`fs.*`, `git.status`/`git.diffFile`, `spec.graph`, `review.get`) — a read is
  the "a client is looking" signal — and `stopWatch` runs in `workspace.remove`'s fast path.
  `workspace.watchReady` forwards an optional `prewarm` flag into `watch`'s bounded prewarm-only tier, so
  a pre-selection warm-up never grows the watcher registry unboundedly — see [[submodule-server-watch]].
- **Analytics**: `initializeAnalytics` at boot from the launcher-threaded option, a `setAnalyticsSending`
  sync teed off the settings publisher, a best-effort `shutdownAnalytics()` in `stop()`, and **every
  `track()` call site**: `chat_started` in `startChat`, `message_sent` after an accepted
  `session.prompt`/`steer`/`followUp` (skipped when contracts' `isControlMessage` recognizes the client's
  TODO wake-nudge — the same wire methods carry it and it is not a user message), and `provider_login`
  from a successful `agent.authenticate` plus a successful `agent.jbcentralConnect`. Feature modules never
  track.
- **Not wired, and why:** `watch`'s `setSkillPathClassifier` — there is no host-side notion of a skill
  path any more (see [[submodule-server-watch]]).
- **`auth`'s `setAgentCredentials` IS wired**, at boot, to an adapter that reaches a named agent's live
  `AgentConnection` through `AgentSupervisor`. It has to be: `agentAuth` answers every `agent.providers` /
  `agent.authMethods` / `agent.authenticate` / `agent.logout` / `agent.setProvider` /
  `agent.disableProvider` through that resolver, so while it was unset the host reported *no configured
  provider for every agent, unconditionally* — which the Welcome banner then rendered as fact. An agent
  with no live connection still degrades to "no agent is reachable"; that is the honest answer only for
  an agent that genuinely is not running.

## The handler registry

One entry per `WS_METHODS` name. Most are a straight call into the owning feature. The compositions only
the host may make:

- **`session.list`** decorates the session manager's summaries with `openTodos` per chat (`agent` stays
  todos-free; a failed count omits the field, never fails the list).
- **`session.create`** calls `workspaces`' `ensureWorkspaceScratchDir` first — the Default workspace's
  gitignored `.thinkrail/context/` lands in the user's repo only when a chat actually starts there, and a
  worktree's deleted scratch dir self-heals.
- **`workspace.remove`** rejects a `kind: "default"` workspace loudly, before any side-effect, then reaps
  everything rooted in the worktree **non-blockingly**: the fast part synchronously (`forgetWorkspace` →
  `evictSpecIndex` → `removeWorkspaceReviews` → `stopWatch` → `closeWorkspaceTerminals`), then acks, then
  the slow reclamation in the background (`archiveTeardown`, fire-and-forget). **Archive now keeps the
  chats**: the teardown calls the session manager's `releaseWorkspace`, which closes the live sessions and
  releases — never deletes — their transcripts, so archived chats stay readable and searchable
  ([[architecture]] Decision #16). Ordering holds: terminals (sync) and sessions (background, before the
  reclaim) are down before the directory is deleted, since they hold it as cwd.
- **`agent.select`** stores the project's agent override, mapping the bundled id back to `null` so
  "use the default" and "pin the bundled agent" do not drift apart in storage.
- **`agent.registry` / `agent.install`** live here rather than in `agent`, which declined them: the data
  dir and the download belong with the host. `agentInstall.ts` reads the ACP registry through
  `@thinkrail/acp` (cached 6h; a failed fetch answers `stale` with the last good list rather than an
  empty one), marks entries installed against the local catalog, plans the install, verifies the
  archive's `sha256` when the registry names one, unpacks into `agentsDir()` and records the catalog
  entry. This is one of the host's two `@thinkrail/acp` imports, and it touches no ACP protocol type.
- **`agent.add` / `agent.remove` / `agent.detect`** (`agentCatalog.ts`) are the in-app half of
  `thinkrail agent add|remove`, sharing its two refusals — the **bundled id is neither addable nor
  removable**, and an unknown id on remove is an error rather than a cheerful `ok`. They differ on
  purpose in one place: the CLI's `add` **replaces** a row of the same id (that is how you re-point a
  moved binary from a terminal), while `agent.add` **refuses** it by name. A form whose Add button
  silently overwrites the agent already under that id is a footgun a command line does not have, and
  the UI's re-point is remove-then-add, which shows the user what changed. Every one of the three ends
  in the `agent.changed` publisher.
  **Removal deliberately leaves `Project.agentId` and `AppConfig.defaultAgentId` alone**: those are
  opaque ids ([[architecture]] Decision #20), and `agent`'s `resolveAgent` already raises
  `UnknownAgentError` naming the id at the point of use — re-pointing a project at some other agent
  behind the user's back would be a silent change of who is writing their code. `agent.detect` is the
  one composition here: the handler reads the cached registry through `listRegistry(false)` and hands
  the entries to `listDetectedAgents`, which folds in the installed catalog and runs
  `@thinkrail/acp`'s curated probe ([[submodule-acp-registry]]) — so detection costs no fetch of its
  own and cannot drift from the list the install picker shows.
- **The review send flows** — see [[submodule-server-reviews]] for the send semantics; `withReviewLock`
  serializes them together with every review mutation, because two different things fall into the gap
  between "read the drafts" and "the chat exists": a second *send* forks the review, and a *mutation*
  invalidates the package already built. `review.get` is deliberately unlocked (its load → re-anchor →
  persist is one synchronous pass, and hydration must not queue behind a send).
- **`history.search`** turns the wire's `HistoryScope` into the two predicates `history` searches the
  transcript corpus with (`historyScope.ts`). The scope is expressed in **workspace ids**, not cwds: the
  transcript corpus records a chat's workspace directly, so an archived workspace still scopes its own
  chats even though the registry no longer lists it.
- **`template.*`** resolves `workspaceId` → `worktreePath` before calling `templates`, which stays
  registry-free.

**Four methods answer honestly rather than pretending**, each because a seam that does not exist yet:
`skill.list` / `skills.state` / `project.skills` / `project.aliasSkills` return **empty** (the skills
catalog is agent-side and reachable only over the ThinkRail `_ext` channel; `ChatCapabilities.skills` is
`false` for every agent that does not advertise the extension, so the UI renders nothing — absence, not a
disabled control), while `session.reloadResources`, `agent.refreshConfig` and `session.answerQuestion`
**throw a message naming the missing seam** (the first two need the same `_ext` channel;
`ask_user_question` is an MCP tool and ThinkRail's MCP server is not running). Throwing beats returning a
plausible-looking answer: a caller that reaches them is a caller whose capability gate is wrong, and it
should hear so.

## Auto-rename: one pass now, not two

`autoRename.ts` tees off the chat publisher. It used to run twice — an instant heuristic name, then a
cheap-model refinement — but the model call had no ACP equivalent and was **deleted**, not ported (see
[[submodule-server-assist]]). What is left is the instant half:

`maybeNaiveNameWorkspace(sessionId, workspaceId)` fires when the first prompt lands
(`isPromptCommitted(event)` — a **user `message_start`**, which is the event that carries the whole user
message under this transcript model). It reads the session's transcript, takes the first clean turn
(`extractFirstTurn`), derives a display name (`naiveWorkspaceName`), and renames **provisionally**
(`lock: false` — name and derived branch move, `renamed` stays unset). It fires only on a **pristine**
workspace (`!renamed` AND branch still `workspace-N` — gated on the branch, not the display name, so the
two stay decoupled), so it lands exactly once and never overwrites a user's name; a per-workspace
in-flight set dedupes re-fired prompt-commits. The rename self-emits `workspace.updated` through the
lifecycle publisher, so the tee pushes nothing itself, and every failure path resolves `null` with a
warn log — a broken rename must stay distinguishable from "there was nothing to name".

## Boundary

- **Owns:** everything in the file table above.
- **Public surface (barrel):** `createServer`, `CreateServerOptions`, `RunningServer`, `bootHost`,
  `BootHostOptions`, `BootedHost`, and a re-exported `BuildKind` so a launcher can name its own
  provenance without importing `analytics`.
- **Allowed deps:** `contracts` (`PROTOCOL_VERSION`, `WS_CHANNELS`, types); `shared` (`freePort`,
  `shellEnv`, `codedError`); `@thinkrail/acp`'s **registry** exports, in `agentInstall.ts` and
  `agentCatalog.ts` only; every feature module it composes (per the parent dependency graph, incl.
  `persistence`'s `dataDir` for the crash log and `fs`'s `resolveWorktreeFile` for the `/files` route);
  Bun/Node.
- **Forbidden:** being imported by any feature module; importing `web`/`cli`/`desktop`; **any pi
  package**; **any ACP protocol type** — `agentInstall.ts` and `agentCatalog.ts` touch
  `@thinkrail/acp`'s registry surface, which names no ACP shape.

## Get right

- Every registered WS command is debug-traced by **method name only** (`ws <method>` / `ws <method>
  failed`); a name absent from the closed handler registry is traced as fixed `ws unknown method` instead.
  Never trace raw unregistered method names, params, or handler error text, which can reflect credentials
  and user-supplied values; see `submodule-server-log`'s privacy rule.
- **A send is accepted synchronously now.** The session manager's `prompt`/`steer`/`followUp` mint the
  message id and take ownership immediately, whether the message goes out this instant or at the end of
  the turn in flight, so there is no acceptance window to wait out and no `ackSend` policy left. The only
  synchronous failure is "no such chat"; every later fault settles in the chat as a `turnSettled` marker.
  Anything that used to key off accept-vs-reject (the review rollback, the send analytics gate) keys off
  that synchronous throw instead.
- **`boot.test.ts` boots the real host, so it owns a throwaway data dir.** `createServer` reads and
  writes `dataDir()` for real — analytics' `installation.json`, `terminals.json`, config, projects,
  workspaces — and `reviveTerminalSessions()` acts on what it finds there. Without a per-test
  `THINKRAIL_DATA_DIR` the suite mutates the developer's own `~/.thinkrail` and takes its behaviour from
  the developer's config; no test in this repo may touch that directory.
- **The host survives its agents.** [[architecture]] Decision #13: a fatal agent fault is one supervised
  child, reported as an `AgentStatus` on the chat channel. `crashLog.ts` still exists for the host's
  *own* faults — it is no longer the place an agent crash lands, and it is never installed under
  `NODE_ENV=test`, where a unit-test process reports its own faults.
- **Shutdown settles before exit.** `bootHost`'s SIGINT/SIGTERM handler awaits `disposeAgentSessions()`
  (which cancels pending permission/elicitation answers so a dying host never leaves an agent blocked on
  a question, closes every connection and flushes the transcript store) concurrently with a bounded
  `shutdownAnalytics()`, then stops the server and exits.
