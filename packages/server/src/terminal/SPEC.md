---
id: submodule-server-terminal
type: submodule-design
parent: module-server
status: active
title: terminal — workspace PTYs
depends-on: [module-contracts]
tags: [v1]
---

## Responsibility

Workspace-scoped `bun-pty` terminals rooted in the worktree cwd, and the per-workspace catalog of terminal
identities. A tab's shell outlives every client that looks at it; each frontend independently references its
`tabKey` from local workspace-view placement, which this module never receives.

## Boundary

- **Owns:** the persisted per-workspace terminal catalog (stable existence/metadata order, not visual
  workbench placement) and the PTY behind each tab, keyed by
  `(workspaceId, tabKey)`; batched output on `terminal.data` plus `terminal.exit` / `terminal.detached`
  (addressed) and `terminal.tabs` (broadcast), via injected publishers; the bounded per-terminal output
  recorder replayed on attach.
- **Public surface (barrel):** `reserveTerminal`, `attachTerminal`, `listTerminals`, `writeTerminal`,
  `resizeTerminal`, `closeTerminalTab`, `resumeClientTerminals`, `closeWorkspaceTerminals`,
  `persistTerminalSessions`, `reviveTerminalSessions`, `closeAllTerminals`, `resetTerminalState` (test seam),
  `setTerminalPublisher`,
  `setTerminalTabsPublisher`;
  the `TerminalDeliveryResult` type shared with the host publisher adapter.
- **Allowed deps:** `persistence`, `contracts` (`WS_CHANNELS`, `TerminalWindowsShell`), `bun-pty`,
  `Bun.which`, `process.env`, `ideBridge` (`ideBridgePort`/`SSE_PORT_ENV` only — the env handoff below).
- **Forbidden:** `host`; sibling features. No WebSocket type crosses this boundary — clients are opaque keys.

## Decisions

- **Shell selection is terminal-local**, and Windows' choice is additionally user-configurable
  (`AppConfig.terminalWindowsShell`, `apps/web/src/panels/TerminalSettings.tsx`'s Windows-only picker;
  [[task-windows-default-terminal-shell]]). Precedence, highest first: an explicit `SHELL` env var always
  wins (unchanged — the host does not invent a global `SHELL` on Windows, since it's a Unix login-shell
  convention and mutating it would affect the in-process agent and every unrelated child process merely to
  configure this module's PTY executable); then, on Windows only, `terminalWindowsShell`:
  - `"auto"` (default): `pwsh.exe` (PowerShell 7+) if `Bun.which` resolves it on PATH, else
    `powershell.exe`. No further fallback to `cmd.exe` — `powershell.exe` ships on every supported
    Windows release, so it is already the guaranteed floor. `defaultWhich` passes an explicit
    `{ PATH: process.env.PATH }` rather than calling `Bun.which` bare, the same trap `editors`'
    `defaultWhich` guards against: `Bun.which` alone reads the PATH snapshotted at process start, not
    `resolveShellEnv()`'s later-repaired live `process.env.PATH`.
  - `"pwsh"` / `"powershell"` / `"cmd"`: literal pins to `pwsh.exe` / `powershell.exe` / `cmd.exe` — no
    existence check, no silent substitution. A pin that turns out to be missing fails to spawn the same
    way a stale custom `SHELL` already does; not a new failure class, and the only mode with graceful
    substitution is `auto`.
  - Non-Windows platforms are unaffected: `/bin/bash` regardless of `terminalWindowsShell`.
  `cmd.exe` was the unconditional prior default; `"auto"`'s baseline is `powershell.exe`, a plain
  fallback swap (ships on every supported Windows release, so no new dependency), because it is more
  functional than `cmd.exe` (line editing, tab completion, VS Code's own default) with no downside for the
  default install. **The Windows default deliberately never consults `ComSpec`/`COMSPEC`**: that variable
  is virtually always the OS's own `cmd.exe` path — it names the interpreter for `cmd /c`/batch-file
  invocations, not a documented "pick my interactive shell" knob — so honoring it ahead of `powershell.exe`
  would leave the default unchanged for nearly every install; a user who deliberately swapped their command
  interpreter already has the `SHELL` override, and a second, weaker override would just be dead code. VS
  Code's own default Windows terminal profile detection makes the same call.
- **Known, accepted limitation: PowerShell weakens busy-close detection.** `closeTerminalTab`'s busy check
  (`shellBusy.ts`) counts the shell's OS child processes. Many PowerShell cmdlets do their work in-process
  rather than shelling out — `sleep` is a built-in alias for `Start-Sleep`, which blocks inside
  `powershell.exe` itself and spawns zero children, unlike `cmd.exe`'s external `sleep.exe` — so a
  PowerShell terminal genuinely busy in a native cmdlet (`Start-Sleep`, `Invoke-WebRequest`, `Copy-Item`,
  a dot-sourced script) can read as idle and be force-closed without warning. Everyday dev-tool invocations
  (`git`, `npm`, `bun`, `python`, `docker`, `node`, ...) are still external executables and stay correctly
  detected — this is a real but narrow gap, same accepted-limitation category as `shellBusy.test.ts`'s
  "an unanswerable platform reports not busy" case. A user who hits it can pick **Command Prompt (cmd)**
  and get the exact prior, fully-detectable behavior back.
- **Not building a `listAvailableShells`-style host probe** to gray out an uninstalled pick in the Settings
  picker, unlike `editors`' `listAvailableEditors`: `auto` already gets the graceful substitution most users
  want, and probing purely to decorate three static buttons wasn't asked for — a second detection mechanism
  earning less than it costs.
- **macOS PTYs start the user's shell in login mode (`-l`)** to match Terminal.app and the platform's
  terminal convention; other platforms keep a plain interactive shell. The PTY itself supplies
  interactivity, so no explicit `-i` is needed.
- **A shell is keyed by `(workspaceId, tabKey)`**, never by a socket, a client, or a component. `tabKey` is
  durable and client-supplied; PTY ids are per-run and **never persisted** (attaching to an id that outlived
  its process is Theia's `Couldn't attach - can't find terminal with id`).
- **Catalog reservation and PTY attachment are separate.** `reserveTerminal` idempotently records a
  client-minted tab identity without spawning. A new reservation is transactional: validate and insert,
  persist the complete catalog, then publish membership; persistence failure removes the in-memory insertion
  and publishes nothing. `attachTerminal` remains idempotent get-or-create and the only way a PTY is born.
  This is not a liveness split: a client still never holds the only pointer to a running shell.
- **The default terminal is a host-composed creation handshake, not layout seeding.** `host` sees the
  workspace's durable pending marker, calls `reserveTerminal` with its deterministic key, and asks
  `workspaces` to clear the marker only after catalog persistence succeeds. Retrying is idempotent; closing
  that terminal later cannot recreate it because the marker is already clear. This module never imports the
  workspace registry or chooses frontend placement.
- **Durable terminal identities are bounded.** A workspace catalog holds at most 256 tabs; a key is non-empty
  and at most 500 characters, and a title is non-empty and at most 1000 characters. Reservation and new attach
  share those checks. Revival truncates oversized catalogs, drops invalid keys, and repairs invalid titles
  before exposing host-authoritative membership.
- **Tracked-grid updates are change-only.** Each live entry tracks the grid applied at spawn or by the last
  successful resize. Attach and explicit resize advance that grid only when it changes, and failed calls do not
  advance it. A reattach may still perform a *transient* redraw nudge (below) that leaves the tracked grid
  untouched. Even a same-grid resize can wake the shell through `SIGWINCH`; a redraw emitted
  after the attach snapshot can overwrite freshly replayed rows.
- **Reattaching to an unchanged grid still nudges the foreground app** (`nudgePtyRedraw`, `ptyGrid.ts`):
  `TIOCSWINSZ` to the same size is a kernel no-op — no `SIGWINCH`, so a full-screen alt-screen app (vim,
  htop, an interactive CLI) left running behind a tab that was switched away and back gets no signal to
  repaint, and the recorder never captured its alt-screen content to replay in its place (see below) — the
  tab would otherwise show a frozen pre-alt-screen buffer. `attachTerminal`'s reattach branch resizes to
  `cols - 1` only when the real resize above was a no-op, forcing a genuine `SIGWINCH`; the restoring
  resize back to `cols` is **deferred** (`NUDGE_RESTORE_DELAY_MS`, `setTimeout`), not fired back to back
  with the first. Two `pty.resize()` calls in the same tick are, from the child's perspective, a single
  observable transition — its own event loop never gets scheduled between them — so an ncurses-style app
  ends up seeing "same size as before" and does its normal *incremental* refresh (diffing against what it
  last drew) instead of a full clear-and-redraw; that paints new content over whatever stale/blank buffer
  the client is currently showing rather than replacing it — visibly garbled, not merely stale, and worse
  than doing nothing. The deferred restore gives the child a real scheduling opportunity to observe — and
  fully redraw at — the intermediate size before the second resize lands. The restore checks liveness
  (`terminals.get(id) === entry`) before firing, since the tab may have closed or respawned in the
  interval, and it also checks that the tracked grid is still the one it captured: a real resize landing
  during the delay would otherwise be undone by the restore, leaving the PTY at the old size while the
  tracked grid says otherwise — and the change-only rule then makes retrying the new size a no-op. This is the same "redraw after the attach snapshot" class of race the bullet above already
  accepts, deliberately triggered every reattach instead of only incidentally.
- **Agent detection is polled, and rides the tab snapshot** (`agentWatch.ts` + `processTree.ts`). A PTY
  reports its own I/O, never which process holds its foreground, so nothing pushes "an agent is running
  here" — it has to be observed. One `ps -Ao pid=,ppid=,comm=` snapshot per tick builds a pid→children
  map covering every terminal at once, so cost is a single subprocess per tick no matter how many tabs
  are open; a per-terminal `pgrep` would scale with tab count. A tab is running an agent when a
  descendant of its shell is named `claude` (verified: a live Claude Code process reports exactly that
  `comm`), searched breadth-first to `MAX_DESCENDANT_DEPTH` so a wrapper script still resolves, with a
  visited set so a cyclic parent chain terminates. The result is folded into `TerminalTabInfo.agent`
  rather than a new channel — clients already subscribe to `terminal.tabs`, so this needs no new wire
  surface — and is broadcast **only when the detected set actually changes**, never on every tick.
  Because an agent appearing is not a membership change, that broadcast deliberately skips
  `persistTerminalSessions()`; only open/close/archive persist.
- **`poke()` arms the timer and never sweeps inline.** `attachTerminal` calls it, and a synchronous `ps`
  on that path blocks long enough for a login shell to fork its profile — which `closeTerminalTab` then
  reads as a busy shell, turning a fresh tab into a close-confirmation prompt. Detection is allowed to
  lag a tick; attach is not allowed to block. The timer stops itself once no terminals remain.
- **Ownership is the host's owner, not the browser page.** Any client may attach; consistent with `history`,
  `todos` and `templates`, which already assume a single-owner host. Consequence: shells survive a reload, a
  closed browser and a different browser.
- **Attach is exclusive with takeover.** A PTY has one size, so a new attach becomes the recipient and the
  previous client gets `terminal.detached`. Mirroring is additive if ever wanted.
- **Only the attached client may drive a terminal.** `writeTerminal`/`resizeTerminal` take the caller and
  no-op otherwise: a displaced client keeps a valid PTY id and a reconnect replays its queued frames, which
  would land in whoever holds the tab now. Reclaiming is an explicit gesture, as in `tmux attach -d`. Such a
  caller is **re-told it is detached** — the original notice is fire-and-forget and can be lost (a client
  mid-reconnect during the takeover replays its attach and gets the cached success back), so learning on the
  first keystroke is what stops a tab looking live while nothing happens. The client also guards the reverse
  order with an attach generation, so a stale attach response can never clear a newer detach.
- **Output stays addressed**, never broadcast — a frame only ever reaches a client that attached. The tab
  *catalog* is the exception: which terminals exist is shared domain state (architecture #12), so every
  reservation or removal fans out on `terminal.tabs` as an idempotent per-workspace snapshot.
- **A shell dies from exactly five causes:** tab closed, workspace archived, natural exit, host stop, orphan
  sweep on attach. Unmounting a view kills nothing.
- **No idle culling.** Terminal "activity" can only mean last PTY I/O, so a quiet long-running command would be
  culled mid-flight (Jupyter's `cull_inactive_timeout` does exactly this). **No abandoned-client reap** either.
- **Revive, not reconnect, across a host restart.** Shells cannot survive it. **Membership is persisted on
  every change** (open / close / archive), not only at `stop()` — the host has no crash isolation, so an
  ungraceful exit is an ordinary path and a shutdown-only file would resurrect a closed tab and spawn a shell
  for it. `stop()` additionally captures a full set of recordings before `closeAllTerminals()`;
  `reviveTerminalSessions()` restores tabs whose first attach spawns a fresh shell showing the old picture.
  Recordings are best-effort, so an unclean exit gives back the right tabs with blank screens.
- **Not tmux.** Would buy restart survival at the cost of a dep we can't assume on Windows, a competing tab
  model, env-propagation breakage, and `capture-pane` polling. We already accept no crash isolation.

## Tab titles

A tab adopts the title the program inside it sets for itself (OSC 0/2) — how a terminal has always
reported what it is running, and how Claude Code names a session, so a tab says what it is doing instead
of "Terminal 3". `renameTerminal` strips null bytes and bounds the length, because this is arbitrary
output from whatever happens to be running; an empty title means "no opinion" and restores the tab's own
name rather than blanking it. When the tab's agent is Claude Code (`agentWatch`), `adoptedTitle`
(`terminalTitle.ts`, unit-tested) also drops the one leading symbol Claude prefixes its title with — the
`✳` at rest, a spinner frame while it works — because the tab already wears the Claude mark and its own
activity spinner, and "✳ ◑ Open WebUI…" was the mark twice. A plain shell's title is never touched that
way: `~` and `$` open real titles. The poll that recognises the agent runs a tick behind Claude's
first title (set the instant it starts), so the same rule is re-applied to every tab of the workspace
whenever the watch reports a change — the title adopted before the agent was known loses its glyph the
moment the agent is. Warp resolves this the same way and adds one rule worth keeping in mind
before a manual rename lands: a **custom title always wins over OSC**
(`app/src/terminal/model/terminal_model.rs`), otherwise the next prompt would overwrite the name the
user chose.

## Resuming an agent session

A terminal that had Claude running when the host went down comes back with the invocation to resume it
**typed at the prompt but not run**. Restoring a session spends tokens and re-reads context, so the
decision stays the user's; the tab is otherwise an ordinary shell.

- **Unless a surface promised otherwise.** `setResumeRunPolicy` is the seam by which a feature that owns a
  terminal — today the blueprint's author, which promises the pair comes back together — says "this one is
  mine, run it". Attach then returns `prefillSubmit`, and the client sends the offer with a trailing `\r`
  instead of leaving it at the prompt. This module knows nothing about blueprints: `host` composes the
  policy, the same way it composes every other cross-feature edge. Without it the author terminal came
  back with `claude --resume <id>` sitting unsubmitted, which reads as "revive is broken" rather than
  "here is an offer" — the tab was restored by the layout, so the blueprint's own restore saw it as
  already present and issued nothing.

- **Two halves, two sources.** The *command* comes from the process table — `captureProcessCommand` reads
  the agent's argv once, when the poll first sees it, so the flags the user chose (`--chrome`, a model)
  survive. The poll itself stays name-only: `args=` is unbounded and would be carried for every process
  on the machine every tick, to be discarded. The *session id* exists only inside the agent, and reaches
  us as the plugin's terminal escape sequence — so the client parses it and hands it back through
  `terminal.rememberAgent`. **Either half is written the moment it lands**: the plugin reports its id
  within milliseconds of starting while the poll can be a tick behind, and persistence runs on membership
  changes, of which an agent appearing is deliberately not one — so both the detection and the report
  persist on their own. **Without the plugin there is no id, and the offer becomes `--continue`**:
  Claude's own "latest conversation in this directory", which is the session that just died in that
  worktree, rather than a guessed id (a guess at *which* session is worse than none, and this is not
  one). The same fallback covers an id whose conversation is not on disk. A host that crashed under a
  running session therefore always comes back with a revive to press Enter on, plugin or no plugin.
- **Only a session that was still running.** Persistence records the pair only while `agentWatch` reports
  a live agent for that tab, and clears both the moment it exits. A conversation the user finished before
  closing is not something to resurrect. The judgement is the poll's, not the shell's: when the app quits,
  every pty dies *before* the shutdown persist runs, and the exit handler destroys the tab's entry — so a
  pair still set at pty exit means the shell died out from under a live agent, and `onExit` moves it into
  `carriedAgent` the same way it carries the final screen into the replay. Without that carry the shutdown
  persist found no entry and wrote `agent: null` for every tab whose shell had already died — which was
  most of them, every quit — and the session id at the moment of closing was lost. A conversation the user
  actually ended is still not carried: the poll cleared the fields when the agent exited, so there is
  nothing left at pty exit to carry.
- **The prefill is consumed by the first revived shell**, like the replay, rather than held for every
  later reattach — the offer belongs to the interrupted session, and typing into a shell already in use
  would be an intrusion. **Handed over is not the same as answered**, though: a line typed at a prompt and
  never run is gone with the shell, so an offer the user did not act on is *carried* (`carriedAgent`) and
  persisted again, and the next start makes it once more. It stops being made when something actually runs
  in that tab — the poll seeing an agent there retires it, whether that is the resumed session or anything
  else — or when the tab is closed. This is deliberately the opposite of the first rule here, which
  dropped the offer the moment a shell was handed it: that made "not now" indistinguishable from "no", and
  a user who reopened the app twice lost the session for good.
- **The offer is verified against disk.** Claude writes a conversation only when
  the session has something to save, so one started and killed before its first prompt leaves an id that
  resolves to nothing and produces `No conversation found with session ID`. `agentSessionExists` checks
  for `~/.claude/projects/<cwd with / and . as ->/<id>.jsonl` before offering, which is also what keeps a
  carried offer from outliving the conversation it names.
- `resumeCommand` rebuilds rather than appends: an existing `--resume` (from a previous restore) or a
  `--continue` is dropped, since `--resume a --resume b` is not a command anyone meant to run. The id is
  required to be a UUID, so nothing from the process table can be pasted into a shell as anything else.
  **Only the invocation survives — the executable and its flags.** The process table reports argv
  unquoted, so `claude 'solve issue 130'` arrives as `claude solve issue 130`, and a rebuild that kept
  every word would hand the resumed session its opening prompt again as a new message. Positional words
  are dropped; a word after a flag is kept as that flag's value unless the flag is one the `claude` CLI
  takes no value for (`BOOLEAN_FLAGS`). An unlisted boolean flag followed by a prompt is the accepted
  ceiling: its first prompt word rides along as a value. `continueCommand` is the same rebuild ending in
  `--continue`.

## Restrictions

- **`attachTerminal` and its handler must stay synchronous.** Lookup and insert in one tick is what makes
  attach atomic on Bun's single event loop; an `await` between them reintroduces double-spawn.
- **`closeTerminalTab` checks `busy` and kills in the same synchronous pass.** A separately-asked question
  lets a process started in between die unannounced.
- Recorder rules: raw bytes (not a serialized grid); never replay resize events; re-emit observed private
  modes **except mouse tracking (1000/1002/1003/1006)** — those belong to a live foreground program, and a TUI
  that exits without its own `DECRST` leaves the last observed value stuck at `on`, so re-emitting it into a
  fresh xterm at a bare prompt turns every mouse move into an SGR report the shell echoes back as garbage;
  **never record the alt screen**, tracking it as a *stream* since a switch can split across PTY reads
  and both screens can appear in one; **never record a mode sequence itself** (replaying `?1049h` would flip
  the fresh terminal to the alt screen); applied in one write on bind. **`restore()` parses what it is handed
  instead of copying it** — the persisted string is a `snapshot()`, so a verbatim copy moves its mode preamble
  into the body, where it stops being a re-derivable summary and becomes literal bytes that every later
  snapshot replays and re-persists: one bad mode then outlives the run that observed it, across restarts.
- Attach hands back the recording and then **discards** held batcher output — the replay already contains it.
- **`mouseModeGuard.ts` fixes the *live* half of the same class of bug the recorder rule above fixes for
  restore:** a TUI that leaves SGR mouse tracking (1000/1002/1003/1006) enabled without a matching `DECRST`
  leaves xterm.js honoring it forever, so every mouse move over what's now a bare shell prompt gets encoded
  as a report and echoed back as garbage. Two independent triggers, since neither alone covers every real
  TUI observed in practice:
  - `transform()` taps the live PTY byte stream (`terminalManager.ts`'s `pty.onData`, upstream of both the
    recorder and the batcher) and injects a reset immediately after an alt-screen exit whenever mouse
    tracking was left on — covers a TUI that pairs mouse mode with the alt screen (vim, htop, …) but
    crashes or is killed before its own cleanup runs.
  - `resetIfEnabled()` is a fallback driven by `agentWatch`'s `onAgentCleared`: **Claude Code's own CLI
    runs inline, never touching the alt screen**, so `transform()` has no signal to key off for it —
    process-tree polling noticing the `claude` process is gone is the only trigger available, wired through
    `terminalManager.ts`'s `createAgentWatch` call, pushed through the same `recorder`/`output` pair as
    `pty.onData`. Coarser (bounded by `AGENT_POLL_MS`) and reactive rather than synchronous, but the only
    option short of shell integration (OSC 133) telling us a foreground process just returned control.
  Either path is a one-shot reset per left-on episode, never a fresh timer or poll of its own.
- **A spawned PTY carries `CLAUDE_CODE_SSE_PORT` when the IDE bridge is up.** A `claude` started in this
  terminal then connects to ThinkRail's editor bridge from its own environment instead of scanning
  `~/.claude/ide/*.lock` and matching cwds — the same handoff the official VS Code extension performs.
  `ptyEnv` reads the live port per spawn (absent when the bridge is off, which is the default), so a
  terminal opened before the setting was turned on simply lacks the variable rather than carrying a stale
  one. See [[submodule-server-ide-bridge]].
- **A spawned PTY is stamped `THINKRAIL_TERMINAL=1` and `THINKRAIL_AGENT_STATUS_URL`, and the URL is how
  an agent in it reports what it is doing.** The address is loopback, carries a token minted for that tab
  (`agentStatus.ts`), and is what the Claude Code plugin POSTs to; the host resolves the token to a
  workspace and tab and pushes the report to clients. The token is the identity: a report never claims a
  tab, and a process that was never handed one cannot report as any. A closed tab's token is forgotten
  with it. **`THINKRAIL_MCP_URL` is stamped beside it, carrying the same token on the host's `/mcp/`
  route** (`agentMcpUrl` / `agentTokenOwner`): one identity per terminal, two things it can say — what
  it is doing, and a call into ThinkRail's own tools (see mcp/SPEC.md). **One caller mints a token for
  something that is not a tab:** the Claude Code pane's `claude mcp list` probe, under a reserved
  non-UUID tab key, so its health check of ThinkRail's own MCP server answers as the workspace instead of
  failing on an unset variable (claudeConfig/SPEC.md). `agentMcpUrl` is exported for it; `agentStatusUrl`
  stays internal.
  **This replaced an escape sequence, and the reason is the whole point.** Status used to travel as OSC
  777 written into the PTY, whose original meaning is "show a desktop notification". Every terminal that
  implements it renders whatever arrives and none filter on a target string, so the plugin — installed
  globally in `~/.claude` — turned every hook event in every other terminal into a toast carrying our raw
  JSON. The guard was the emitter checking `THINKRAIL_TERMINAL`, a convention rather than a boundary,
  and it silently failed for weeks. A POST cannot leak: no terminal is involved, and outside our PTYs
  there is no address to send to.
- **OSC 777 is never recorded, same reasoning as never recording a mode sequence: it is a one-shot event,
  not terminal content.** ThinkRail's own agent reports no longer travel that way, but any other tool's
  still can, and a stale `notify` sequence sitting in the recorded buffer would re-fire on every reattach
  (tab remount, page reload, host revive) — asking for a notification about something that finished hours
  or days earlier. `outputRecorder.consume()` strips a complete `ESC ] 777 ; … (BEL|ST)` sequence before it ever
  reaches `append()`, covering a split across two `push()` reads at any byte offset in the escape prefix —
  the same rigor `PARTIAL_MODE_RE` already gives CSI mode sequences. Because `restore()` runs through
  `consume()` too, a snapshot persisted by a pre-fix host is scrubbed the same way the mouse-tracking one
  is. Title (OSC 0/2) is untouched — it's genuinely persistent display state, and the existing
  `reportedTitle` de-dup already makes a replayed title idempotent.

## Validation

- `outputRecorder.test.ts` — bounds, line/escape-safe trimming, alt-screen exclusion (incl. a switch split
  across reads and enter+exit in one read), mode restoration, mouse tracking never restored, `restore()`
  keeping mode sequences out of the body (incl. a recording persisted by a host that still replayed them),
  and OSC 777 exclusion (incl. a split at any offset in the escape prefix, the ST terminator form, an
  unrelated OSC left untouched, and scrubbing a notify sequence out of a pre-fix persisted recording).
- `mouseModeGuard.test.ts` — passthrough of clean output, well-behaved apps left untouched, forced reset on
  a dirty alt-screen exit, `resetIfEnabled()` for the inline-TUI fallback, no reset when mouse tracking was
  never on, fires only once per left-on episode, a mode sequence split across chunks.
- `outputBatcher.test.ts` — batching, backpressure, truncation, `reset`.
- `shellBusy.test.ts` — child detection, including that an unanswerable platform reports *not* busy.
- `shellArgs.test.ts` — shell executable precedence across Unix and Windows plus platform-specific
  arguments; `auto`'s pwsh-then-powershell resolution via an injected `WhichFn`; every explicit preference
  is a literal pin regardless of what `which` reports; `ComSpec`/`COMSPEC` no longer influence the result.
- `terminalManager.test.ts` — transactional durable reservation without spawn, catalog bounds, attach
  idempotency (incl. concurrent), takeover, displaced-client rejection, tab-list broadcast, close/busy,
  revive. Replay-persistence and natural-exit cases use bounded publisher-observed data/exit conditions as
  readiness edges, never elapsed time; their expected output marker never appears contiguously in the command
  input, so terminal echo cannot impersonate command execution.
- `terminalManager.test.ts` — an unclaimed offer is typed and never run, a claimed one carries
  `prefillSubmit`, and the claim is per tab and per workspace.
- `agentResume.test.ts` — an unwritten session refused, flags preserved, an earlier `--resume`/`--continue` replaced rather than stacked,
  a bare `--resume` (the picker) consuming no following flag, and a non-UUID id refused.
- `processTree.test.ts` — `ps` row parsing (spaces in names, `.exe` stripping, header junk), descendant
  search across generations, depth cap, and cycle termination.
- `agentWatch.test.ts` — detect/clear transitions notify exactly once, a steady state stays silent, a
  closed tab drops its entry, the timer stops at zero terminals and restarts, repeated pokes never stack
  a timer, and an unreadable process table changes nothing.
- `e2e/terminals.spec.ts` — the rapid re-entry regression, reload survival, second-client takeover,
  cross-client tab convergence.
