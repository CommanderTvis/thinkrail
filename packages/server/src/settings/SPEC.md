---
id: submodule-server-settings
type: submodule-design
status: active
title: settings — server-synced app config
parent: module-server
depends-on: [module-contracts]
tags: [v1]
---

## Responsibility

The server-synced app config — OUR settings (an opaque theme selection, the **global default agent id**,
the analytics switch, terminal replay budget, the chat composer growth preset, a bounded custom layout-preset catalog (the workbench frame itself is
frontend-local now), and the plan-review policy — `reviewModel`/`reviewEffort`
(the model + effort the reviewer & reflector sessions run on; unset ⇒ the agent's default) and
`reviewAutoFix` (default true; when false a `request_changes` verdict records findings and waits instead
of auto-sending a fix — `host/todoReview` reads it at the verdict gate)), an extensible `AppConfig` bag.
Reads/merges/persists it and fans changes out to every client,
so a preference set on one client follows the user to the others (architecture #9: shared domain state). The
web client owns the available theme manifests; settings stores only the selected string id. The same
opacity holds for `defaultAgentId`: it is a string this module stores and never validates —
[[architecture]] Decision #15's global half, whose per-project override lives on `Project.agentId`, and
which `agent` resolves against the installed catalog at the moment a chat uses it. `null` means the
bundled agent.

Current workbench frame, workspace resource placement, current/default preset selection, side/bottom group limits, selection, and focus are explicitly absent. Those are frontend-surface-local view state under [[submodule-web-shell-layout-state]]. Built-in layout presets remain web-owned.

A numeric setting is bounded by its consumer when the domain owns the safety cap—for example `terminal`
clamps `terminalReplayKb`, so a hand-edited config cannot exhaust memory. Settings itself validates custom
layout presets because it owns their cross-frontend storage contract.

## Boundary

- **Owns:** cached current `AppConfig`; `getConfig()`; `updateConfig(partial)` (merge → validate known fields → persist → broadcast); resource-free custom-preset validation/normalization and safety caps; `setSettingsPublisher`; and `resetConfigCache` for tests.
- **Public surface (barrel):** `getConfig`, `updateConfig`, `setSettingsPublisher`, `resetConfigCache`, plus pure custom-preset normalization used by host startup after persistence load.
- **Allowed deps:** `persistence` (`loadConfig`/`saveConfig`); `contracts` (`AppConfig`, `LayoutPreset`).
- **Forbidden:** host or another feature sibling; current-layout document/snapshot types; workspace ids/resources; current frame validation; owning WS channels; or importing web preset definitions.

## Get right

- **Converge on broadcast, no client optimism.** `updateConfig` persists before publishing; every frontend, including the initiator, adopts `settings.changed`. `server.welcome` seeds the same cached value.
- Theme availability/labels/palettes are not server concerns. Unknown theme ids remain persisted; each independently shipped frontend resolves visual fallback.
- Retired host-layout and chat-message-order fields are ignored rather than persisted or broadcast. Layout instantiation and transcript order are frontend-local preferences.
- Custom layout presets are a complete top-level catalog replacement, not a nested per-item patch. Each value is bounded, resource-free, uniquely identified, uses only the current preset schema, and contains no workspace/tab/session/terminal identity. A malformed persisted member is isolated during config validation; a wire mutation with any malformed member is rejected as a whole. No alternate config key or old preset schema is read or upgraded.
- Deleting or editing a custom preset changes only the shared definition. It cannot mutate any frontend's instantiated frame or local default selection.
- `null` clears optional `reviewModel`/`reviewEffort` overrides; it is a wire-only sentinel and never persists.
