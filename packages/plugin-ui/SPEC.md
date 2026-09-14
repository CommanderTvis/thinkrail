---
id: module-plugin-ui
type: module-design
status: active
title: plugin-ui — the shared UI kit
parent: module-plugin-api
tags: [v1, ui, plugin-api, public-surface-checked]
surfaces: [src/index.ts, src/markdown/index.ts, src/editor/index.ts, src/visualization/index.ts]
---

## Responsibility

The presentational primitives, markdown renderer, code editor, and visualization card every plugin's
web half needs, extracted out of `apps/web` so a plugin can render UI without reaching into the host
app's store, transport, themes, panels, or chat internals. No build step — a consumer (today only
`apps/web`, eventually an external plugin's own web bundle) imports the TypeScript source directly, the
same way `packages/contracts` does.

Modal menus and dialogs must resolve the same Radix dismissable-layer instance: it owns the shared
body pointer lock. Opening a confirmation from a context menu with a different instance can capture
`pointer-events: none` as the original value and restore it after confirmation, blocking all page clicks.
The context-menu release stays aligned with the dialog and dropdown-menu dependencies. The file deletion
browser regression opens a preview, confirms deletion, then opens another file to verify interaction recovers.

The tooltip call-site audit scans TSX in `apps/web/src` and workspace packages' `src`/`web` directories.
It excludes tests and never traverses dependency trees: the former recursive package-root scan followed
`node_modules` links and timed out. A known source file must be present so an empty scan cannot pass.

## Boundary

- **Owns:** the eleven shadcn/Radix primitives (`button`, `dialog`, `dropdown-menu`, `context-menu`,
  `popover`, `command`, `textarea`, `tooltip` + `IconTooltip`, `resizable`, `toast`) and `cn`, all at the
  root; `Outline`/`OutlineColumn`/`OutlineToggle`/`scrollToHeading` + the pure `outlineTree`
  (`HeadingEntry`, `OutlineNode`, `buildOutlineTree`); `ToggleSegment`; the `CHIP*` class-name constants;
  `ToolFileLink`; `useThemeSwap`; `ScopedSetting` — the one row every agent plugin's configuration pane
  renders a layered setting with (key, scope chip, value slot, the file it came from, shadowed values
  struck through beneath), plus its `ScopeChip`/`SourcePath`/`RowAction` parts and `abbreviateHomePath`; `SettingValueDialog`, the
  popup that composes one value — text, number, on/off, a list of text, or one of a closed set of
  choices — and hands back the key and value, leaving where it is written to the plugin; with `knownKeysOnly` a new key is picked from the
  plugin's documented list rather than typed, and `shapeFor` sets the editor from that key's declared type.
  A choice picker is used only when the selected key returns a nonempty list of choices; a supplied
  lookup callback alone must not hide the boolean, text, number, or list editor.
  `SettingsToolbar` is the filter-and-add bar above the rows; `TerminalFacts` — the fact chip (the
  agent's working directory, model, effort) and the attach-file button every terminal agent's accessory
  row shows, with `cwdLabel` (a home-abbreviated path whose middle is what truncation eats) and
  `attachPath` (a picked path relativized against the agent's cwd), plus `TerminalPlan` (the agent's own
  todo list behind a done/total toggle, named after the agent in its titles) and `TerminalUsageChip` (the
  session's token spending, `↑in ↓out R cache-read W cache-write`, no cost — a subscription makes cost
  meaningless), plus `TerminalIdeContextChip`, a controlled session-only `/ide` on/off control. The
  caller owns issuing the agent command and the enabled state; the kit holds no terminal or plugin state.
  `formatTokens`/`tokenUsageParts` are the one token formatting: pi's chat stats bar uses
  them too, adding only its cost. The numbers are whatever the plugin read from its agent's own record;
  the kit never estimates.
  Settings show `key = value` on one line when their content fits the row; otherwise the value
  moves below the key. Long keys wrap within the panel, and long values retain their line clamp.
  Setting documentation links show their help text in the shared themed tooltip on hover and focus;
  they do not set a native `title` tooltip.
  Source, scope, and actions stay on the metadata line below. `./markdown`: `Markdown`, `CodeBlock`, `highlightCode`/
  `cachedHighlight`, the GitHub-alert remark transform (`markdownAlerts`), and the Shiki
  CSS-variable theme (`shikiTheme`). `./editor`: `MonacoEditor`, `monacoSetup` (theme definition,
  shared options, language lookup), `editorFont`, `editorWrapping`, `monacoMenuIcons`, the pure review
  helpers `reviewGutter`/`reviewWidgets` (+ their `EditorReview`/`SideReview` type shapes). `./visualization`:
  `VisualizationCard`, `DiagramCard`, `ComparisonCard`, `MermaidView`, `PanZoomView`, `renderMermaid`,
  `parseComparisonOptions`, the shared `zoomGesture` scale math.
- **Entries:** `.` (primitives + `cn` + `Outline`/`ToggleSegment`/chips/`ToolFileLink`/
  `useThemeSwap`), `./markdown`, `./editor`, `./visualization`, `./tokens.css` — each a barrel; no
  deeper import reaches into a subpath's files. `components/ui`'s old "no barrel, per-primitive import"
  convention does not carry over: the primitives are light (no Monaco/shiki), so one root barrel is fine,
  and the heavy pieces stay behind their own subpaths precisely so a consumer's bundler still code-splits
  Monaco/shiki/mermaid out of the initial chunk (`lazy(() => import("@thinkrail/plugin-ui/editor"))`).
  `./tokens.css` is a stylesheet, not a barrel, so it carries no checked surface below.
- **Public surface (`.`):** `AccountRow`, `AccountUsageWindow`, `accountReadingLabel`, `Button`, `ButtonProps`, `buttonVariants`, `menuItemClass`, `CHIP`, `CHIP_DISABLED`,
  `CHIP_OFF`, `CHIP_ON`, `cn`, `Command`, `CommandEmpty`, `CommandGroup`, `CommandInput`, `CommandItem`,
  `CommandList`, `CommandSeparator`, `ContextMenu`, `ContextMenuContent`, `ContextMenuItem`,
  `ContextMenuSeparator`, `ContextMenuTrigger`, `Dialog`, `DialogClose`, `DialogContent`,
  `DialogDescription`, `DialogFooter`, `DialogHeader`, `DialogTitle`, `DialogTrigger`, `DropdownMenu`,
  `DropdownMenuContent`, `DropdownMenuGroup`, `DropdownMenuItem`, `DropdownMenuLabel`,
  `DropdownMenuRadioGroup`, `DropdownMenuRadioItem`, `DropdownMenuSeparator`, `DropdownMenuSub`,
  `DropdownMenuSubContent`, `DropdownMenuSubTrigger`, `DropdownMenuTrigger`, `Outline`, `OutlineColumn`,
  `OutlineToggle`, `scrollToHeading`, `buildOutlineTree`, `HeadingEntry`, `OutlineNode`, `Popover`,
  `PopoverAnchor`, `PopoverContent`, `PopoverTrigger`, `abbreviateHomePath`, `RowAction`, `ScopeChip`,
  `ScopedSettingRow`, `ScopedSettingSource`, `SettingsToolbar`, `SettingValue`, `attachPath`, `cwdLabel`, `TerminalAttachButton`, `TerminalFactChip`, `TerminalIdeContextChip`, `TerminalPlan`, `TerminalTodo`, `TerminalUsageChip`, `formatTokens`, `TokenUsage`, `tokenUsageParts`, `SettingValueDialog`, `shapeOf`,
  `SourcePath`, `SvgAsset`, `ValueShape`, `ImperativePanelGroupHandle`,
  `ImperativePanelHandle`, `ResizableHandle`, `ResizablePanel`, `ResizablePanelGroup`, `ToggleSegment`,
  `ToolFileLink`, `Textarea`, `Toast`, `ToastClose`, `ToastDescription`, `ToastProvider`, `ToastTitle`,
  `ToastViewport`, `toastVariants`, `IconTooltip`, `Tooltip`, `TooltipContent`, `TooltipProvider`,
  `TooltipTrigger`, `useThemeSwap`.
- **Public surface (`./markdown`):** `CodeBlock`, `FrontmatterProperties`, `FrontmatterBlock`,
  `FrontmatterProperty`, `parseFrontmatter`, `serializeFrontmatter`, `withFrontmatter`,
  `remarkHeadingIds`, `cachedHighlight`, `highlightCode`, `Markdown`, `MarkdownRehypePlugins`,
  `AlertVariant`, `alertComponents`, `parseAlertMarker`, `remarkGithubAlerts`, `stampedSelectionLines`,
  `THINKRAIL_SHIKI_THEME`, `THINKRAIL_SHIKI_THEME_NAME`.
- **Public surface (`./editor`):** `applyCodeFont`, `cssVar`, `editorFontSize`, `editorWrappingOptions`,
  `EditorSelectionChange`, `MonacoEditor`, `decorateEditorContextMenus`, `defineThinkrailTheme`,
  `EDITOR_THEME`, `editorGpuUsable`, `gpuAcceleration`, `languageForPath`, `sharedEditorOptions`, `THEME`,
  `watchThemeSwap`, `applyReviewDecorations`, `LineSelection`, `EditorReview`, `SideReview`,
  `attachReviewCommenting`, `attachReviewThreads`, `ReviewCommentingCallbacks`, `ReviewThreadActions`,
  `ReviewThreadData`, `threadLabel`.
- **Public surface (`./visualization`):** `ComparisonOptionView`, `parseComparisonOptions`,
  `ComparisonCard`, `DiagramCard`, `MermaidView`, `MermaidRenderResult`, `renderMermaid`, `PanZoomView`,
  `resultText`, `strArg`, `VisualizationToolProps`, `VisualizationCard`, `clampZoomScale`,
  `isZoomGesture`, `ZOOM_MAX_SCALE`, `ZOOM_MIN_SCALE`, `ZOOM_SCALE_STEP`, `zoomScaleForWheel`.
- **Allowed deps:** Radix, `cmdk`, `class-variance-authority`/`clsx`/`tailwind-merge`, `@remixicon/react`,
  `react-markdown`/`remark-gfm`/`shiki`/`@shikijs/langs`, `@monaco-editor/react`/`monaco-editor`,
  `mermaid`, `react-resizable-panels`. `react`/`react-dom` are peer dependencies — the kit renders into
  whatever React instance its host mounted, never bundles its own.
- **Forbidden:** `@/…` (there is no path alias here — a consumer's `@/` never resolves inside this
  package), any host app's store, transport, themes runtime, panels, or chat internals. A prop or
  callback replaces every one of those reaches: `MonacoEditor` takes `lineWidth`/`lineWidthBounded`/
  `gpuRendering`/`ligatures` instead of reading them off a store, and `onSelectionChange`/`onSendToChat`/
  `onClose` instead of calling a transport function directly. Theme-change notification has no line back
  to a host's theme runtime either — `useThemeSwap` watches `document.documentElement` for `data-theme`/
  `class`/`style` mutations with a `MutationObserver` and calls back on any of them, which is how
  `monacoSetup.watchThemeSwap` and `MermaidView`'s redraw-on-swap both stay host-agnostic.

`MonacoEditor.onSelectionChange` reports the exact one-based Monaco range, including a selection
ending at column one of the next line. `onSendToChat` retains the chat-facing trimmed last-line
convention. Mixing the two made an IDE selection covering a whole line look like a zero-length
range even though its selected text was present; the Codex IPC browser test pins the exact endpoint.
- **Duplicated on purpose, not shared:** `cn`, `editor/colorUtils.ts`'s `cssColorToHex`/
  `supportsDevicePixelBox`, and root `pathUtils.ts`'s `isAbsolutePath`/`projectRelativePath`/
  `hasUriScheme`/`workspaceFileTarget` (for `ToolFileLink`) are small, pure copies of functions
  `apps/web/src/lib` also keeps for its own much larger set of app-only path/color helpers. The kit
  cannot import `apps/web`'s `lib` (that is the exact reach this package exists to avoid), and
  `apps/web`'s `lib` cannot become a dependency of a UI kit without inverting the app/package
  relationship, so the handful of lines these two components need are copied rather than shared. Treat a
  behavior fix to path/color handling as needing both copies checked, not just one.

## Account presentation

`AccountRow`, `AccountUsageWindow`, and `accountReadingLabel` own the common agent account presentation.
Rows pair a label with a right-aligned value. Usage windows show a clamped used percentage, an accessible
native progress bar, and a relative reset time; past resets identify stale readings instead of implying
zero usage. Reading timestamps show both age and absolute time. Plugins normalize provider timestamps
to milliseconds and retain ownership of fetching, empty/error states, and provider severity. A provider
without severity uses the normal accent; the kit invents no warning thresholds.

## The token-name contract

Nothing in this package declares a color, a font, or a spacing value — every visual property is either a
Tailwind utility (resolved by whichever host's Tailwind build actually processes this source, hence the
two `apps/web/src/index.css` `@source` lines pointing back at this package) or a `var(--…)` read straight
off `document.documentElement`'s computed style. That makes the CSS custom-property *names* below a
contract this package depends on existing, wherever it is mounted:

- **Semantic color roles** — every `--color-<role>` name in `apps/web/src/styles/colors.json` /
  `styles/generated/colors.css` (`border-default`, `text-muted`, `container-elevated-bg`, `primary`,
  `feedback-error`, …). Tailwind utilities built from these (`bg-container-elevated-bg`,
  `text-feedback-error`) are what every primitive and card in this package renders with.
- **Monaco's theme mapping** (`editor/monacoSetup.ts`'s `defineThinkrailTheme` + its `SYNTAX_TOKENS`
  table) reads, verbatim: `--code-foreground`, `--text-muted`, `--primary`, `--editor-selection-bg`,
  `--editor-selection-text`, `--container-content-bg`, `--container-workspace-bg`, and per syntax scope
  `--code-keyword`, `--code-string`, `--code-comment`, `--code-comment-doc`, `--code-number`,
  `--code-regexp`, `--code-annotation`, `--code-tag`, `--code-attribute-name`, `--code-attribute-value`,
  `--code-property`, `--code-function`, `--code-type`, `--code-variable`, `--code-constant`,
  `--code-operator`, `--code-punctuation`. `markdown/shikiTheme.ts` maps the same `--code-*` names into
  Shiki's TextMate scopes for fenced code blocks, so a color renamed on one side and not the other
  silently desyncs editor and chat syntax highlighting.
- **Mermaid's theme mapping** (`visualization/mermaid.ts`'s `themeVariables`) reads `--text-default`,
  `--border-default`, `--container-elevated-bg`, `--container-workspace-bg`, `--control-bg-selected`,
  `--container-content-bg`, `--text-muted`, `--tr-font-family-code`.
- **Type and layout tokens**: `--tr-font-family-code` (the one code font, read by Monaco, mermaid, and
  every `tr-code-text`/`tr-prose-*` utility class alike), `--tr-line-height-default` (Monaco's line
  height), and the `--space-*` scale for anything not expressed as a Tailwind spacing utility.

A host that mounts this package's components is responsible for publishing every name above on
`document.documentElement` before first paint; nothing here has a fallback beyond what `getComputedStyle`
returns for an unset custom property (empty string, which Monaco and mermaid both treat as "use the
built-in default").
