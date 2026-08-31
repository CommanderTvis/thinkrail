---
id: submodule-server-templates
type: submodule-design
status: active
title: templates — file CRUD over ThinkRail's prompt-template dirs
parent: module-server
depends-on: [module-contracts, submodule-server-persistence]
references: [architecture, submodule-server-host]
tags: [v1, templates]
---

## Responsibility

File CRUD over ThinkRail's two prompt-template directories (global + project-scoped): list / get / save /
delete `.md` files, surfacing their frontmatter (`description`, `argument-hint`) as metadata. Consumed by
the `template.*` host handlers; this module owns no WS surface itself — `cwd` is passed in by the caller
(a resolved workspace), never looked up here.

## Prompt templates are host-owned now

They used to be **pi's** templates: `<piAgentDir>/prompts` and `<cwd>/.pi/prompts`, read back by pi's own
loader, with pi's `parseFrontmatter` doing the parsing. Under [[architecture]] Decision #13 the agent is a
separate process the host cannot reach into, and under the repo invariant only `packages/pi-agent` may
import pi at all — so mirroring another program's on-disk convention from here is no longer possible or
meaningful. A template is now **ThinkRail's own document**, stored where ThinkRail stores things:

- **global** — `<dataDir>/prompts`, i.e. `~/.thinkrail/prompts`.
- **project** — `<cwd>/.thinkrail/prompts` (`WORKSPACE_INTERNAL_DIR`, the same worktree-local directory
  the scratch/context dirs live under), so a repo can ship templates with its code.

`templateDirs(cwd?, globalDir = promptsRoot())` is pure path arithmetic; `promptsRoot()` reads `dataDir()`
**at call time**, so a test (or the e2e seeder) that sets `THINKRAIL_DATA_DIR` after this module loaded is
still honoured.

**Consequence, stated plainly:** templates a user wrote under `~/.pi/agent/prompts` or `<repo>/.pi/prompts`
are not read any more, and ThinkRail's templates are not offered in pi's own `/` menu. The two systems
were only ever coincidentally the same directory; ACP gives no way to keep them the same, and pretending
otherwise would mean a pi-shaped path in a host that no longer knows what a pi is. What a template *is*
did not change — a `.md` file with optional frontmatter — so a user can move a directory and keep working.

## Frontmatter: a flat scalar reader, on purpose

`frontmatter.ts` is this module's own reader, ~20 lines, replacing pi's YAML-backed `parseFrontmatter`:

- Newlines are normalized, then an opening `---` line is required; everything up to the next line that is
  exactly `---` is the block. No opener ⇒ no frontmatter, never an error.
- Inside the block, each `key: value` line contributes one **string** entry. A wrapping pair of matching
  single or double quotes is stripped. An empty value, or a YAML **block-scalar indicator** (`>`, `|`,
  with any chomping/indent suffix), contributes **nothing** — degrading to "no metadata" rather than
  surfacing `>-` as a description. Nothing else is interpreted: no nesting, no lists, no anchors.
- Only two keys are ever read: `description` and `argument-hint` (kept kebab-case on disk, camelCased on
  the wire as `TemplateInfo.argumentHint`).

The reader is flat because the data is: two optional strings on the wire. A YAML dependency to parse two
strings would be the tail wagging the dog, and every richer YAML shape a user could write has a defined,
quiet degradation above.

**Reading never fails on frontmatter; writing does.** A file whose `---` fence is never closed reads as a
file with no metadata (both `listTemplates` and `getTemplate` — no asymmetry). But `saveTemplate` **rejects**
it before touching disk, because a caller sending an unclosed fence is authoring one and means it: the
save is a no-op on the filesystem rather than an orphan file on disk with metadata nobody will ever see.

## Design

- `listTemplates` re-reads both directories **on every call** — no cache, anywhere in this module. The `/`
  menu, the Templates settings panel, and a template saved seconds ago must agree; the cost is two small
  `readdir`s.
- `isValidTemplateName` is the **traversal gate**: applied to every caller-supplied `name` before it is
  `join()`-ed into a path, in `getTemplate`, `saveTemplate` and `deleteTemplate` alike. Its job is
  path-traversal *safety*, not naming style, so it rejects only the shapes that are unsafe as a single
  filename segment — empty, a leading `.` (covers `.`, `..`, and `.hidden`-style dotfiles with one rule),
  a path separator anywhere in the name (`/` or `\`), or an embedded NUL — and accepts everything else,
  including interior dots (`foo.bar`), uppercase, spaces and unicode. `listDir` filters directory entries
  through that **exact same predicate**, so list/get parity holds structurally rather than by convention:
  a name the gate refuses is invisible to the listing too, and the two can never drift apart.
- **The no-follow gate (symlink containment):** the traversal gate constrains the *name*; this one
  constrains what the name may *resolve to*. Every by-name operation `lstat`s the target (never following)
  and treats anything that is not a regular file — a symlink first of all — as **not a template**:
  `getTemplate` reports it absent, `saveTemplate` refuses to write through it (loud, nothing touched),
  `deleteTemplate` reports it not-found; `listDir` skips symlinks structurally. This module is a
  *write-capable CRUD surface over the wire*, so following `.thinkrail/prompts/linked.md → ~/somewhere`
  would let `template.get` disclose the target and `template.save` overwrite it — a checked-out repo could
  plant a link and turn a routine template edit into a file write outside the worktree. The same rule
  applies **one level up**: a symlinked `<cwd>/.thinkrail` or `<cwd>/.thinkrail/prompts` *directory* (the
  repo controls those components) makes the project dir untraversable for **every** project-scope
  operation — `listTemplates`/`getTemplate` treat it as having no templates (one shared predicate,
  `readableProjectDir`, so they cannot disagree), while `saveTemplate`/`deleteTemplate` refuse loudly (a
  write must fail visibly, never silently no-op). The **global** dir is exempt on purpose: `~/.thinkrail`
  is user-owned (anyone writing there has already won) and dotfile managers routinely symlink it. The
  `lstat`-then-write gap is a TOCTOU race only a concurrent local process could exploit — out of scope for
  an owner-scoped host, since such a process could write the target directly.
- **Bounded listing + the size cap:** `listTemplates` is **metadata-only** (`TemplateInfo`, no `content`)
  and does bounded work per file: `readTemplateMeta` reuses the no-follow `lstat` as a size gate (a file
  over **`MAX_TEMPLATE_BYTES`**, 1 MiB, is silently skipped — list/get parity: neither surfaces it
  usefully) and reads only the first 8 KiB for the frontmatter, so a pathological >8 KiB block degrades to
  "no metadata" rather than a full-file read. The **full text** travels only on the by-name
  `template.get`/`template.save` path, where an oversized file/payload fails **loudly** (read: before
  `readFileSync`; save: before anything touches disk) — a directly-named operation deserves a loud answer.
- `listDir` keeps **two layers of failure containment**: a per-file read failure skips that one file, and
  the directory scan itself is wrapped so an unreadable directory (EACCES, or a path that is not a
  directory at all) returns what had already been collected instead of blanking the *other* scope's
  results too.
- `listTemplates`'s result is sorted by `name` — `readdir` order is not guaranteed across platforms, and
  every consumer of a template *list* wants a stable order more than an arrival order.

## Boundary

- **Owns:** file CRUD in exactly the two sanctioned dirs (`TemplateDirs.globalDir` / `.projectDir`); name
  validation as the traversal gate; the frontmatter reader and its `description` / `argumentHint`
  extraction. Never touches any other path — only `join(dir, \`${name}.md\`)` after `name` has passed
  `isValidTemplateName`.
- **Public surface (barrel):** `templateDirs`, `promptsRoot`, `TemplateDirs`, `listTemplates`,
  `getTemplate`, `saveTemplate`, `deleteTemplate`, `isValidTemplateName`, `MAX_TEMPLATE_BYTES`.
- **Allowed deps:** `persistence` (`dataDir`, for the global dir), `shared` (`WORKSPACE_INTERNAL_DIR`),
  `contracts` (`Template` / `TemplateInfo` / `TemplateScope`), `node:fs`, `node:path`.
- **Forbidden:** importing `workspaces` / `projects` — stays registry-free like `history`; the `template.*`
  handler resolves `workspaceId` → `cwd` and passes `cwd` into `templateDirs` itself. **Any pi package**
  (the whole reason this module was rewritten). **Any ACP type.** Caching the listing across calls.
  Reading or writing anything outside `globalDir` / `projectDir`.

## Get right

- **`content` is the full file text, frontmatter included.** `Template.content` round-trips byte-for-byte
  through `saveTemplate` → disk → `getTemplate`; the reader only ever produces *metadata*, never a body.
- **Fresh read, every call.** No in-memory cache anywhere in this module — deliberate, not an oversight.
- **List/get parity, both directions — structural, not a convention.** `isValidTemplateName` excludes only
  the shapes that are unsafe as a filename segment; tightening it into a "clean slug" regex silently
  breaks parity (a perfectly ordinary `foo.bar` would list but 404 on get). The scan and the gate share
  one predicate — do not reintroduce a second, parallel check in either direction.
- **`deleteTemplate` throws when the target is already gone** rather than treating a missing file as a
  successful no-op. A delete only reaches this module because a caller named one specific
  existing-as-far-as-it-knows template; if it is gone, that view is stale and the handler should say so.
