---
id: submodule-web-lib
type: submodule-design
status: active
title: lib — UI helpers
parent: module-web
tags: [v1]
---

## Responsibility

Tiny UI helpers shared across components.

## Boundary

- **Owns:** `utils.ts` → `cn()` (re-exported from `@thinkrail/plugin-ui`, the kit's own canonical
  definition, so every existing `@/lib`/`@/lib/utils` import site is untouched) + `isMarkdownPath()` (the
  `.md`/`.markdown` gate for the rendered-preview view) + `stripFrontmatter()` (drop a leading YAML `---`
  block so the rendered view doesn't render spec metadata as a heading) + `cssColorToHex()` (canonicalize
  a CSS color to hex — minified CSS serves `#fff`/`gray`-style equivalents, which strict consumers like
  Monaco and xterm reject; `""` when unparseable). Plus the primitives that more than one module needs and
  none should re-state: **`normalizePath()`** / **`isAbsolutePath()`** (a path from a pi tool call or the
  host may use either separator and may be relative or absolute — every path predicate in the app starts
  from these, so `chat`'s display helpers and `store`'s worktree matcher share one definition) and
  **`shallowEqualArrays()`** (element-wise `Object.is` — the "did this really change?" test behind the
  store's snapshot-identity guard and `ErrorBoundary`'s reset keys), **`userText()`** (a user
  message's plain text — shared by `chat`'s transcript hydration/renderer and `store`'s live event
  fold, so "same message" means the same thing everywhere; it lives here because `store`'s edge to
  `chat/` is type-only), **`parseSkillInvocation()`** + **`matchesSkillInvocationCommand()`** (the
  anchored browser-side mirror of Pi's canonical expanded `<skill>` user-message grammar, shared by
  `chat`'s compact renderer and `store`'s optimistic-echo reconciliation; malformed/quoted blocks fail
  closed),
  **`relativeTime()`** (`just now` / `5m ago` / `2d ago` — shared by chat history, the tab strip's closed
  chats, and the Changes scope menu's commit rows; it lives here because `chat/` may not import from
  `panels/`, which is what let three private twins of it accumulate), **`platformShortcutLabel()`** +
  **`hasPlatformModifier()`** (one Apple-vs-other definition for shortcut chrome and global handlers; both
  default to the browser-reported platform but accept an explicit platform string so non-browser callers and
  tests never inherit a host runtime's synthetic `navigator` accidentally), and
  **`copyText()`**
  (clipboard write reporting whether it landed — one place for the *degradation*: an insecure context
  (plain-http remote access) or a denied permission has no clipboard, and every caller's answer is the same
  — do nothing loud, the text stays visible/selectable), **`randomId()`** (16 random bytes through
  `getRandomValues`, which remains available to a plain-HTTP remote client),
  **`zoomGesture.ts`** — what a zoom *gesture* is and where it leaves the scale
  (`isZoomGesture`, `zoomScaleForWheel`, `clampZoomScale`, and the min/max/step constants): macOS
  delivers a trackpad pinch as a ctrlKey wheel event, and the step has to follow the delta's *size* or a
  pinch leaps. Shared by the PDF preview and the diagram pan/zoom, since two surfaces disagreeing about
  what a pinch means is a bug the user feels in their fingers. Also
  **`DOUBLE_CLICK_SETTLE_MS`** (the one click→double-click arbitration window shared by cached and
  host-read tab opens), and the
  **`LayoutAttention`** device-local overlay shared by store, shell, and the headless layout child, with
  own-property-safe `readLayoutSelection()` / `readLayoutNavigationClock()` accessors for untrusted
  tuple-keyed maps. **`mergeText.ts`** is the three-way line merge a save falls back on: each side is
  reduced to the base line ranges it replaced, ranges only one side touched are applied, ranges both
  touched agree or become conflict markers — ranges that merely *touch* are not an overlap, so edits on
  adjacent lines still merge. It lives in the client because the buffer being merged is client state: the
  host hands back what is on disk and decides nothing. Line-based rather than character-based, which is
  what makes the markers the same shape the user already knows from git. **`claudeLaunch.ts`,
  `claudeModelPicker.ts` and `claudeEffortPicker.ts` moved to `@thinkrail/plugin-claude-code/web/` whole,
  as part of the plugin-api migration** — the launch-command composition, the CLI's interactive
  `/model`/`/effort` picker-driving (feedback loop over the rendered `❯` row / slider marker, the
  session-only `s` selection, the draft/confirm-prompt guards), and their unit tests all carried over
  unchanged; see that plugin's own SPEC.md. What stayed here is generic and unrelated to which agent (if
  any) a terminal runs: `shellQuotePath()` (now serving the terminal's own drag-a-file-in handler, not a
  launcher) makes a dropped path one shell word. The shared Shiki highlighter (`cachedHighlight`/`highlightCode`,
  remembering what it has already highlighted so a document isn't re-tokenized every time it is opened)
  now lives in `@thinkrail/plugin-ui/markdown` — see that package's `SPEC.md`; `lib` no longer owns it.
  Collision-safe browser identity composition lives here too:
  **`tupleKey()`** length-prefixes independent strings, **`parseTupleKey()`** reads only its requested
  namespace, and **`layoutResourceIdentity()`** gives every frontend-local placement/cache alias one
  semantic resource key, so delimiters and stable noncanonical placement ids cannot split or alias identities.
- **Public surface (barrel):** `cn`, `isMarkdownPath`, `stripFrontmatter`, `cssColorToHex`,
  `normalizePath`, `isAbsolutePath`, `projectRelativePath` (canonical worktree-relative POSIX identity;
  collapses in-root `.`/`..` aliases but preserves an attempted leading escape for host rejection; Windows
  drive-rooted containment compares path/root case-insensitively while preserving the candidate's casing),
  `shallowEqualArrays`, `userText`, `parseSkillInvocation`, `matchesSkillInvocationCommand`,
  `shellQuotePath`, `FILE_DRAG_TYPE`, `startFileDrag`,
  `carriesFileDrag`, `draggedFile`, the `DraggedFile` type, `mergeText`, `hasConflictMarkers`,
  `relativeTime`, `platformShortcutLabel`, `hasPlatformModifier`, `copyText`, `randomId`,
  `DOUBLE_CLICK_SETTLE_MS`, `tupleKey`, `parseTupleKey`, `layoutResourceIdentity`,
  `readLayoutSelection`, `readLayoutNavigationClock`, and the `LayoutAttention` type.
- **Allowed deps:** `clsx`, `tailwind-merge`; `@thinkrail/contracts` (types only for canonical messages;
  the layout-resource identity input is a local structural type); `shiki`/`@shikijs/*` (the per-file shiki modules only — never reachable
  through the barrel).
- **Forbidden:** every app-internal module — this is a leaf.
