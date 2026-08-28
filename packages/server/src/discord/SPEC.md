---
id: submodule-server-discord
type: submodule-design
parent: module-server
status: draft
title: discord — Rich Presence for the Electrobun desktop app
depends-on: [module-contracts, submodule-server-settings]
tags: [v1, desktop, discord]
---

## Responsibility

Speak Discord's local IPC protocol to publish what project and file the user has open on their Discord
profile, gated by `AppConfig.discord`, and answer `discord.status` truthfully about what it did and why.
Fork of [https://github.com/Azn9/JetBrains-Discord-Integration], a quirk of this fork with no plugin system
to hang it off yet.

## Off by default, and honest about what "off" and "unconfigured" mean

`DEFAULT_DISCORD_SETTINGS.enabled` is `false` — Rich Presence is the one setting where "on by default"
would publish something to everyone who can see the user's Discord profile without them choosing to. Even
once enabled it stays silent until `applicationId` is set: Discord always shows the *registering
application's* name, so there is no anonymous "some app is running" state to fall back to — only the
user's own real application will do, and that means creating one at discord.com/developers/applications and
pasting its id in. `decidePresence` in `presence.ts` returns a `"silent"` verdict for both cases, which
`discord.ts` reads as "close the socket if open, publish nothing" rather than trying to connect and
reporting a manufactured failure.

## Where the presence signal comes from

`apps/web`'s active editor tab is the source of truth for "what file is open" — the module never inspects
a workspace on its own, it is *told*. The client calls `discord.presence` with a `DiscordPresence | null`
on every active-tab change (a Zustand subscription in `apps/web/src/discord/reportPresence.ts`), the same
push pattern the IDE bridge uses for selection. `null` means no project is open — the module reads that as
"clear the activity", not as an error.

## Boundary

- **Owns:** the Discord IPC client (`ipc.ts` — handshake, frame read/write, the local Unix-socket
  discovery across the paths Discord's Electron client and its Flatpak/Snap packagings use), the pure
  publish/redact decision (`presence.ts` — no I/O, fully unit-tested) and the connection lifecycle around
  it (`discord.ts` — retry backoff, status caching, reacting to a settings change).
- **Socket discovery cannot depend on the shell's env.** On macOS Discord's socket lives under the
  per-user temp dir, which processes normally learn from `$TMPDIR` — but the Electrobun desktop app's
  bun side is spawned by the native wrapper without a login shell's env, so the search asks the OS
  itself (`getconf DARWIN_USER_TEMP_DIR`, cached) after the env vars and before the `/tmp` fallback.
  This is the second bug that shipped as "Discord is not running on this machine" while it was: the
  browser-launched host inherited `$TMPDIR` and worked, the desktop host did not.
  `THINKRAIL_DISCORD_IPC_DIR` overrides the whole search — the isolation seam for the lifecycle test
  (which must not find the developer's real Discord) and the escape hatch for an exotic setup.
- **A withheld file name publishes no line at all, rather than a false one.** `details` is
  `string | null`, and `SET_ACTIVITY` omits the key entirely when it is null — "No file open" would be a
  lie on a profile whose owner simply turned `shareFileName` off while a file *is* open, and Discord
  renders a missing `details` as just the project rather than an empty row.
- **`decidePresence` is pure and is the single point that can leak a path.** It takes a `DiscordPresence`,
  the current `DiscordSettings`, and an elapsed-time anchor, and returns a `PresenceDecision` — `publish`
  (with the exact activity payload, `basename()`'d so a client-relative path never reaches Discord),
  `clear` (blocked project, or no project open), or `silent` (off / unconfigured). Every other file in this
  module treats its output as the final word on whether anything reaches the socket.
- **The elapsed-time anchor resets on project change, not on file change** — `discord.ts` remembers
  `startedForProjectId` and only stamps a fresh `Date.now()` when it differs, so switching files within a
  project does not restart Discord's "Elapsed" clock.
- **Connection retry is floor-limited (`RETRY_FLOOR_MS`), not looped.** A failed handshake (Discord not
  running, stale socket) records `failure` and the reason; `ensureConnected` refuses to retry until the
  floor has passed, so a client that pushes presence every keystroke does not hammer a socket that is not
  there. The floor is deliberately short (5s) because it is also the *recovery* latency: Discord launched
  after ThinkRail is the common case, not the rare one, and a long floor reads to the user as "it says
  Discord isn't running, but it is".
- **`discord.status` retries rather than reporting a cached failure.** It is `async` and calls
  `ensureConnected` itself before answering, so opening the settings pane re-probes the socket instead of
  echoing a `failure` recorded minutes ago; `applyDiscordSettings` additionally clears `failure` and
  `lastAttempt` outright, so toggling the setting is always an immediate retry with no floor to wait out.
  The client polls `discord.status` while the pane is open, which is what turns a Discord launched
  mid-session into a `connected` line without the user touching anything.
- **Public surface (barrel):** `applyDiscordSettings`, `getDiscordStatus`, `publishPresence`,
  `setDiscordStatusPublisher`, `stopDiscord`, `resetDiscordForTests`, plus `decidePresence` /
  `statusFor` for the test suite.
- **Allowed deps:** `contracts` (`DiscordSettings`, `DiscordPresence`, `DiscordStatus`,
  `DISCORD_APPLICATION_ID`), `settings` (`getConfig`), `log`, Node's `net`/`crypto`/`fs`/`path`.
- **Forbidden:** `host` (the host injects the status publisher, this module never imports it);
  `workspaces`/`projects` (presence is push-only, see above).

## What is honestly not implemented

- **No Rich Presence artwork.** `SET_ACTIVITY`'s `assets` field is omitted — it needs image keys uploaded
  to the registered Discord application ahead of time, which is per-user setup this fork has no UI for yet.
  The activity shows as text-only until that lands.
- **No reconnect-on-Discord-restart push from the OS.** The module notices Discord is gone only the next
  time it tries to publish (the socket's `close` event, or a failed handshake) — there is no filesystem
  watch on the IPC socket directory.

## Validation

- `presence.test.ts` — every `decidePresence` verdict (publish, blocked-project clear, no-project clear,
  off, unconfigured by empty id, unconfigured by a non-snowflake id, file name redaction, a withheld
  file name being indistinguishable from no file rather than claiming one, elapsed-time
  anchor holding across a file change) and `statusFor`'s status/detail mapping, including that a connection
  failure is only ever reported while the integration is actually on.
- `discord.test.ts` — the lifecycle against a fake Discord IPC server on a real Unix socket: a failed
  first attempt reports `unavailable`, a socket appearing *within* the retry floor is deliberately not
  noticed, and `applyDiscordSettings` clears the floor so the next status connects. This is the
  regression that shipped: status was computed from a cached `failure` and never re-probed, so the pane
  said "Discord is not running on this machine" while Discord was running.
