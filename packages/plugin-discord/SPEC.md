---
id: module-plugin-discord
type: module-design
status: active
title: plugin-discord — Discord Rich Presence as a builtin plugin
parent: module-plugin-api
depends-on: [module-plugin-api, module-contracts, module-plugin-ui]
references: [module-server, module-web]
tags: [v1, plugins, desktop, discord]
---

## Responsibility

Speaks Discord's local IPC protocol to publish what project and file the user has open on their Discord
profile, and answers `plugin.discord.status` truthfully about what it did and why. Ported unchanged from
`packages/server/src/discord` (a fork of https://github.com/Azn9/JetBrains-Discord-Integration, a quirk
of that fork with no plugin system to hang it off yet) — the smallest of the plugin ports, chosen to prove
external loading end to end (see `plugin-adoption.md`).

It ships `enabledByDefault: false`: Rich Presence is the one feature where "on by default" would publish
something to everyone who can see the user's Discord profile without them choosing to. Turning it on is
done the same way as any other plugin, from Settings › Plugins — there is no second, plugin-local on/off
switch, since a plugin's settings schema may not declare `enabled` (`validateContractIntake`) and the
generic roster toggle already gates activation (and therefore `dispose()` closing the IPC socket)
completely.

## What moved here, and what changed

- **`ipc.ts`** (the IPC client — handshake, frame read/write, the local Unix-socket discovery across the
  paths Discord's Electron client and its Flatpak/Snap packagings use) and **`presence.ts`**'s pure
  publish/redact decision moved unchanged, save for `DiscordSettings` losing its `enabled` field: the
  plugin is either active or it is not, so `decidePresence` only ever answers `unconfigured` (no valid
  application id), `clear` (blocked project, or no project open), or `publish`. `DiscordConnectionState`
  drops the `"off"` member for the same reason.
- **`discord.ts`'s connection lifecycle** (retry backoff, status caching, reacting to a settings change)
  is now `host/lifecycle.ts`'s `createDiscordRuntime`, a closure-scoped runtime built by `host/index.ts`'s
  `activate` instead of module-level singleton state — each activation gets its own, so a disable/enable
  cycle starts clean rather than inheriting a previous activation's retry floor.
- **`AppConfig.discord`** becomes this plugin's settings schema (`applicationId`, `blockedProjectIds`,
  `shareFileName`); the snowflake validation (`DISCORD_APPLICATION_ID`) moves into `contracts.ts` with it.
  Retired `AppConfig.discord` entries in an old `config.json` are ignored, not migrated.
- **The two methods and the channel**: `discord.presence` / `discord.status` become
  `plugin.discord.presence` / `plugin.discord.status`; the `discord.statusChanged` push channel becomes
  the declared state channel `status`, snapshot method `status`, so a client reads it as a normal
  subscription — the web half no longer polls.
- **`apps/web/src/discord/reportPresence.ts`'s whole-store Zustand subscription** becomes
  `web/reportPresence.ts`'s `ctx.watchHost` over exactly the projection it needs
  (`activeWorkspaceId`, `contextProjectId`, `projects`, `activeEditor`), still debounced 500ms.
- **`panels/DiscordSettings.tsx`** becomes `web/DiscordSettings.tsx`, registered via
  `ctx.settingsSection`; it reads/writes through `ctx.useSettings()` / `ctx.patchSettings()` and blocked
  projects through `ctx.useHost(host => host.projects)` instead of the app store directly. Its own on/off
  switch is gone for the reason above — Settings › Plugins is the only toggle.
- **`components/DiscordMark.tsx`** (the hand-drawn glyph) moves here as `web/DiscordMark.tsx`, used only
  as the settings section's icon. The roster icon is the Remix `discord` name (`RiDiscordLine`/`Fill`,
  added to `apps/web/src/plugins/registry/icons.ts`'s curated map) rather than this mark, since the roster
  renders every plugin's icon the same way.

## Boundary

- **Owns:** `ipc.ts`, `presence.ts`, `host/lifecycle.ts`'s connection runtime, the settings schema and
  its snowflake validation, the settings-section UI, and the presence-reporting watch.
- **Socket discovery cannot depend on the shell's env.** On macOS Discord's socket lives under the
  per-user temp dir, which processes normally learn from `$TMPDIR` — but the Electrobun desktop app's bun
  side is spawned by the native wrapper without a login shell's env, so the search asks the OS itself
  (`getconf DARWIN_USER_TEMP_DIR`, cached) after the env vars and before the `/tmp` fallback.
  `THINKRAIL_DISCORD_IPC_DIR` overrides the whole search — the isolation seam for the lifecycle test
  (which must not find the developer's real Discord) and the escape hatch for an exotic setup.
- **A withheld file name publishes no line at all, rather than a false one.** `details` is
  `string | null`, and `SET_ACTIVITY` omits the key entirely when it is null.
- **The elapsed-time anchor resets on project change, not on file change** — the runtime remembers
  `startedForProjectId` and only stamps a fresh `Date.now()` when it differs.
- **Connection retry is floor-limited (`RETRY_FLOOR_MS`), not looped.** `plugin.discord.status` retries
  rather than reporting a cached failure — it calls `ensureConnected` itself before answering — and a
  settings change clears `failure`/`lastAttempt` outright for an immediate retry with no floor to wait out.
- **Public surface:** `manifest`, `discordContract`, `buildSupport`, the host module's default export, the
  web module's default export.
- **Allowed deps:** `plugin-api`, `contracts` (none of its own domain types — the plugin's contract is
  self-contained), `plugin-ui` (`cn`), Node's `net`/`crypto`/`fs`/`path`/`child_process`.
- **Forbidden:** any `apps/web` internal — the web half reaches the host only through `PluginWebContext`.

## What is honestly not implemented

- **No Rich Presence artwork.** `SET_ACTIVITY`'s `assets` field is omitted — it needs image keys uploaded
  to the registered Discord application ahead of time, which is per-user setup this plugin has no UI for.
- **No reconnect-on-Discord-restart push from the OS.** The plugin notices Discord is gone only the next
  time it tries to publish (the socket's `close` event, or a failed handshake).

## Validation

- `host/presence.test.ts` — every `decidePresence` verdict (publish, blocked-project clear, no-project
  clear, unconfigured by empty id, unconfigured by a non-snowflake id, file name redaction, a withheld
  file name being indistinguishable from no file rather than claiming one, elapsed-time anchor holding
  across a file change) and `statusFor`'s status/detail mapping.
- `host/lifecycle.test.ts` — the lifecycle against a fake Discord IPC server on a real Unix socket: a
  failed first attempt reports `unavailable`, a socket appearing *within* the retry floor is deliberately
  not noticed, and a settings change clears the floor so the next status connects.
- `e2e/plugins/discord/discord.spec.ts` — enabling the plugin from Settings › Plugins, the settings pane's
  application-id validation and persistence, and a blocked project surviving a reload.
