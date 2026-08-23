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

- **Owns:** `utils.ts` → `cn()` (merge clsx output through tailwind-merge) + `isMarkdownPath()` (the
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
  **`DOUBLE_CLICK_SETTLE_MS`** (the one click→double-click arbitration window shared by cached and
  host-read tab opens), and the
  **`LayoutAttention`** device-local overlay shared by store, shell, and the headless layout child, with
  own-property-safe `readLayoutSelection()` / `readLayoutNavigationClock()` accessors for untrusted
  tuple-keyed maps. Also the shared
  appends a preset's flags to the configured command *line* (so the user's own flags keep their place),
  `shellQuotePath()` makes a picked executable one shell word, `CLAUDE_LAUNCH_MENU` is the grouped
  preset list — data, not markup, so the flags are pinned by unit test instead of read out of JSX — and
  `CLAUDE_MODELS` is the one model-alias list, so the launcher's `--model` presets and the
  mid-session switch can never offer different models. **`claudeModelPicker.ts`** is that mid-session
  switch: `driveModelPicker(io, model)` drives the CLI's interactive `/model` picker over an injected
  io (terminal writes + a read of the rendered lines + a delay) to the row naming the model and presses
  `s` — the session-only selection; Enter and the digit shortcuts save the pick as the user's global
  default, which is exactly what a per-terminal switch must not do. The picker's rows vary with the
  current default and its arrows wrap, so the driver is a feedback loop over the rendered `❯` row
  (`pickerHighlight` parses it, `highlightNamesModel` matches label to alias — the bare row or its
  parenthesised variant, never the `Default` row); it escapes out and reports `no-picker`/`not-found`
  when the loop can't land. **The prompt is cleared first and restored afterwards** (`Ctrl+U` then
  `Ctrl+Y`, Claude Code's own kill/yank): a slash command only opens the picker at the start of a line,
  so a half-typed prompt used to swallow `/model` and produce nothing but an unhelpful toast — and every
  exit path yanks the draft back, including the ones that give up. **A cached conversation is asked to
  confirm** ("Switch model? … Your next response will be slower") — the chip's menu was already the
  user's answer, so `confirmationChoice` reads which option the highlight sits on and the drive takes
  "Yes" rather than leaving a question on screen with nobody to press it.
  **`claudeEffortPicker.ts`** drives `/effort` the same way, and differs only in how the picker is read
  and steered: it is a *slider*, so the choice is the rung the `▲` marker sits under (the colour that
  marks it does not survive a terminal buffer, the marker does — `effortHighlight` answers
  geometrically, by which label's middle is nearest), and it is walked with ←/→ by distance rather than
  down a list. The rungs are `low … ultracode`, and a move that changes nothing means the slider
  clamped, so the drive stops instead of pressing into the wall. The io is injected so the loop is pinned by unit test against a scripted
  picker, keystroke for keystroke. Also the shared
  Shiki highlighter, **kept out of the barrel** so the eager `@/lib` import stays shiki-free:
  `highlighter.ts` loads the curated grammars + JS regex engine and renders with `themes`' one generic
  CSS-variable registration. It is imported per-file (`@/lib/highlighter`) from lazy chunks only; theme
  identity/palettes never live in `lib`. Collision-safe browser identity composition lives here too:
  **`tupleKey()`** length-prefixes independent strings, **`parseTupleKey()`** reads only its requested
  namespace, and **`layoutResourceIdentity()`** gives every frontend-local placement/cache alias one
  semantic resource key, so delimiters and stable noncanonical placement ids cannot split or alias identities.
- **Public surface (barrel):** `cn`, `isMarkdownPath`, `stripFrontmatter`, `cssColorToHex`,
  `normalizePath`, `isAbsolutePath`, `projectRelativePath` (canonical worktree-relative POSIX identity;
  collapses in-root `.`/`..` aliases but preserves an attempted leading escape for host rejection; Windows
  drive-rooted containment compares path/root case-insensitively while preserving the candidate's casing),
  `shallowEqualArrays`, `userText`, `parseSkillInvocation`, `matchesSkillInvocationCommand`,
  `claudeLaunchCommand`, `shellQuotePath`, `CLAUDE_LAUNCH_MENU`,
  `relativeTime`, `platformShortcutLabel`, `hasPlatformModifier`, `copyText`, `randomId`,
  `DOUBLE_CLICK_SETTLE_MS`, `tupleKey`, `parseTupleKey`, `layoutResourceIdentity`,
  `readLayoutSelection`, `readLayoutNavigationClock`, the `LayoutAttention` type, `parseCliAgentSequence`,
  `statusForEvent`, and the `ClaudeCodeStatus`/`ClaudeCodePayload` types.
- **Allowed deps:** `clsx`, `tailwind-merge`; `@thinkrail/contracts` (types only for canonical messages;
  the layout-resource identity input is a local structural type); `shiki`/`@shikijs/*` (the per-file shiki modules only — never reachable
  through the barrel).
- **Forbidden:** every app-internal module — this is a leaf.
