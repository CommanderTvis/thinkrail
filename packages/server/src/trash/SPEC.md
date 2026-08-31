---
id: submodule-server-trash
type: submodule-design
status: draft
title: trash — the recoverable-delete primitive
parent: module-server
depends-on: []
references: [submodule-server-transcript, submodule-server-workspaces]
covers: [delete-to-trash]
tags: [v1]
---

## Responsibility

Move one path to the OS trash, and nothing else. Extracted from `agent/` unchanged because two
independent owners now need it — `transcript` (chat delete) and `workspaces` (worktree removal) — and
neither may reach into the other or into `agent`.

## Boundary

- **Owns:** the platform trash call, the bundled-helper seam for the compiled binary, the procfs
  static-include workaround, and the test seam.
- **Public surface (`index.ts`):** `trashFile`, `TrashImplementation`, `BundledTrashHelpers`,
  `setBundledTrashHelpers`, `setTrashImplementationForTests`.
- **Allowed deps:** `trash`, `@stroncium/procfs`, `node:child_process`, `node:util`.
- **Forbidden:** every sibling module; `@thinkrail/contracts`; any knowledge of what is being deleted.

## Decisions

- **Failures propagate.** A recoverable action never falls back to `unlink` — a caller that cannot reach
  the trash must surface that rather than silently destroy the thing. Every caller's rollback is written
  against that guarantee.
- **The procfs parser is statically included.** `trash`'s Linux path asks procfs for `processMountinfo`
  through a template-literal CommonJS require, which Bun cannot discover for a single-file binary; the
  own-property install must run before `trash` is first called, which is why it lives at module scope.
- **The bundled-helper seam stays.** A compiled binary stages the macOS and Windows helpers to real files
  before the host accepts requests.

## Move note

A **verbatim move** of `packages/server/src/agent/trash.ts` + `agent/procfs.d.ts`, plus the barrel.
The only edits are the import paths in `agent/extensions.ts` and `agent/agentSessionManager.ts`;
`agent/trash.test.ts` moves with it.
