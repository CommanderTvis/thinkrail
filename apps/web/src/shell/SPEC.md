---
id: submodule-web-shell
type: submodule-design
status: active
title: shell — responsive frame
parent: module-web
tags: [v1, ui]
references: [module-desktop]
---

## Responsibility

The responsive composition root: top-level app chrome, active-project/workspace routing, theme application, global shortcuts, region error isolation, and composition of layout-agnostic panels into one frontend-local desktop workbench frame. A future mobile shell may project the same panels differently; it must not inherit desktop docking accidentally.

## Boundary

- **Owns:** `Shell` as the one composition root; topbar and persistent location context; active-project/workspace routing; single Settings, analytics-consent, interview-invitation, and Toaster mounts; theme application and global shortcuts; the injected Layout and optional application Update settings sections; and integration of the workbench engine with store, persistence, panels, transport-backed domain state, and error boundaries.
- **Public surface:** `Shell`.
- **Allowed deps:** child layout modules; `updates`; `panels`; `chat` app-integration hydration/rendering; `store`, `transport`, contracts (types only), `components/ui`, `components/ErrorBoundary`, `components/QuietScrollArea`, `constants`, `lib`, `themes`, `plugins/registry`, and `@thinkrail/plugin-api` (types).
- **Forbidden:** server/shared/pi imports; being imported by panels/store/transport; putting arrangement knowledge into a feature panel; or sending current frame/view state through transport.

## Internal modules

Every child is a directory module with `index.ts` as its public surface:

- `layout/` ([[submodule-web-shell-layout]]) is the pure frame/view mutation, projection, and rendering engine. It never imports feature panels, store/transport runtime, or persistence.
- `layoutState/` ([[submodule-web-shell-layout-state]]) owns local hydration, validation, persistence, pristine Balanced initialization, and atomic installation of pure layout results.
- `layoutIntents/` ([[submodule-web-shell-layout-intents]]) owns consume-once arrangement intent routing into pure layout transitions.
- `chatReconciliation/` ([[submodule-web-shell-chat-reconciliation]]) owns host session/local placement/cache/history convergence and chat deep-link orchestration.
- `terminalReconciliation/` ([[submodule-web-shell-terminal-reconciliation]]) owns host terminal-catalog/local placement convergence without owning PTY lifetime.
- `legacySelection/` ([[submodule-web-shell-legacy-selection]]) is the sole temporary adapter from workbench attention to migration-era active editor/terminal/preview mirrors.
- `railDefault.ts` (no barrel, one file) owns `resolvePluginRailDefaults` — the plugin half of "a rail that
  opens on something worth reading" below, pulled out of `WorkspaceWorkbench.tsx` so it is unit-testable
  without that file's panel imports.

The sibling dependency graph is: `layoutState → layout`; `chatReconciliation → layout + layoutState`; `terminalReconciliation → layout`; `layoutIntents → layout + chatReconciliation + terminalReconciliation`; `legacySelection` reaches store selectors/actions only; and `WorkspaceWorkbench` composes each active orchestration barrel with `layout`, panels, and render callbacks. Chat resource availability is isolated behind a per-session selector component; the parent workbench never subscribes to the whole `sessions` record, so a streaming runtime cannot invalidate every tab renderer and side tool behind it. Siblings import only through barrels. Tests live with the orchestration module that owns the behavior rather than making store tests import shell runtime effects.

## Composition

The topbar keeps ThinkRail identity, connection state, Settings, and compact location context, and doubles
as the **window title bar** when a native host removes its own strip ([[module-desktop]], *Native window
chrome*). It is a fixed `h-topbar-row` (`--topbar-row-height`, 40px — macOS title-bar proportions, so
native traffic lights sit centred in it) with `px-16`, and it is host-agnostic: the only host-shaped input
is three CSS custom properties on `<html>`. `--window-chrome-inset-left` / `--window-chrome-inset-right`
are consumed through the `w-window-chrome-inset-*` spacing tokens by one `aria-hidden` edge spacer on each
side (`window-chrome-inset-left|right`); unset (any browser) they resolve to `0px` and the header looks as
before, while the desktop publishes `64px` on macOS so content starts at 80px and collapses it to `0px` in
fullscreen. `--window-chrome-drag-region` drives the header's `window-drag` utility, which resolves to
`no-drag` unless the host publishes `drag`, so a browser tab or a natively decorated window never gains a
drag strip. Padding was deliberately not used for the inset: the `spacingUsage` gate lets padding utilities
name only canonical steps, and a CSS `padding-left: max(…)` would need a gate exemption. The header is
`select-none`; its whole trailing action cluster (`topbar-actions`) is `window-no-drag`, so any button
placed inside it — the Update affordance, quota Retry, Settings — is excluded from dragging by
construction, and buttons must not be placed elsewhere in the header (`topbarChrome.test.ts` gates this),
while plain text (breadcrumb, connection label) stays draggable.
**In the desktop shell the connection pill is hidden while connected**: the host is a child of the app
itself, so a permanent "Connected" reports on a localhost socket the user never chose and cannot act on —
it reads as status where there is none. A *problem* state still shows, in every shell: a host that died
under the desktop app is exactly the case the indicator exists for. The element keeps its `data-status`
hook in the browser, which is what the e2e suite waits on. In the desktop shell the header also answers a
double-click outside its controls with the window's own zoom, which the drag region does not wire;
`electrobunShell.ts` is that seam — two globals the desktop preload sets (`__thinkrailDesktop`,
`__thinkrailToggleWindowZoom`), absent in a browser tab, so every call there is inert.
`SettingsDialog` portals out of the header and is unaffected. Nothing in the shell names or imports the
desktop host. When the optional application updater reports a native `ready` package or CLI-host `available`
release, a compact Update affordance remains beside the settings and connection chrome; it opens the injected
Update section and remains after native Later or until capability state changes. Browsers connected to a host
without the advisory render neither that affordance nor the section. `Shell` mounts `updates`' one capability
hook and passes its normalized state/actions into the props-driven controls; panels receive optional React
content, never a launcher or native-runtime check. The topbar identity is the icon-only ThinkRail mark—the same
vector served as `public/favicon.svg`, inlined at 32×32 and rendered
through semantic `text-primary`—with no divider before location. An active workspace shows one line of
`project / workspace  branch · from baseBranch` plus optional review metadata on `tr-text-ui`; project and
workspace use `text-text-default`, while branch/trailing metadata use `text-text-muted`, with progressive
responsive degradation. A selected project without an active workspace shows Project Home. No selected
project leaves the logo alone.

Immediately before host connection status, the topbar conditionally renders the **JetBrains recurring-quota
readout** (protocol v59): a neutral Coins icon + locale-formatted `remaining / total credits`. It exists only
when the synchronized setting is enabled and the host reports healthy Central; zero has no warning policy.
Loaded/loading are non-button content with a freshness tooltip. First failure is `Quota unavailable · Retry`;
later failure preserves the last value as stale with a small warning freshness marker and Retry. Neither
numeric updates nor the polling loop are aria-live. Narrow widths hide `credits` and the existing connection
label before either icon or quota number.

`Shell` owns the visible-client polling controller: immediate request on activation/reconnect/provider
invalidation/visible resume/config change, then one non-overlapping request after each configured
`1–3600` second interval (default 30). Hidden documents and disabled/host-hidden results cancel the timer;
Retry forces completed-cache age but still joins host single-flight. Request sequence guards prevent an old
response restoring a superseded state. The host owns health, cache, and deduplication; shell never invokes or
interprets Central directly.

With an active workspace, `Shell` mounts the workbench projection of the window's singular frame and that workspace's local view. Switching workspace changes resource contents and attention but never frame topology, Projects/Specs/Files/Changes/Review placement, side/bottom geometry, folds, visibility, or alignment. Shell-owned wrappers around Projects, Files, and Specs use `components/QuietScrollArea`, as does the Project Home navigator; Changes/Review and xterm own their internal quiet-scroll surfaces in `panels`. These primitives never receive or infer placement. `react-resizable-panels` cannot reconcile a panel-count change in place, so switching to a workspace whose default preset has a different shape (e.g. Balanced ↔ Focus) forces the aligned-row and outer `ResizablePanelGroup`s to remount; they carry `motion-safe:animate-fade-in` (an opacity-only twin of `animate-reveal` — no `transform`, since these subtrees can contain ChatView's `position: sticky` breadcrumbs) so the shape change reads as a soft cross-fade rather than a jump. Without an active workspace, Shell mounts Welcome beside the projects navigator using separate local geometry. The Settings dialog, analytics-consent window, addressed interview invitation, and Toasts each mount once above both branches. The consent window is a layout-agnostic panel shared by browser and desktop clients, gated by hydrated host configuration and protocol support; shell owns only its placement. Consent takes precedence over the automatic interview invitation so startup never stacks both prompts.
After `main.tsx`'s synchronous first-paint apply, Shell is the sole mounted theme side-effect owner. While `welcomeGeneration === 0` it retains the versioned preference hint; afterward it projects store's opaque fixed id + fixed/system mode + optional pair through `themes` and writes the reconciled hint. Fixed mode has no media listener. System mode owns exactly one `prefers-color-scheme` listener, reapplies the locally resolved slot on change, and cleans it up on preference/unmount; that local event never mutates store, calls the host, or changes another client. No other component mutates `[data-theme]`.

## Workbench behavior

The durable frame grammar and pure operations belong to [[submodule-web-shell-layout]]. Zustand carries one `WorkbenchFrame`, local layout preferences, and keyed `WorkspaceViewState` values; the mounted document is derived and never persisted as a second authority. Frame-plus-view transitions commit atomically through `layoutState`.

Resource opens route to that workspace's last-focused surviving center group. Reopening a canonical resource selects its local placement rather than duplicating it. Resource close does not remove the frame group when it becomes empty. Explicit split/add/remove/merge commands own topology; group removal deterministically rehomes resources from every locally retained workspace view before one state commit. Applying a preset follows the same all-views rule. Moving a singleton tool or resizing/folding/showing a region changes the one frame; moving a file/chat/diff/document/terminal among existing groups changes only the active workspace view. Pointer/resize drafts stay runtime-local and publish one local transition on completion.

`useReportedActiveFile` lives here still, generic now: it keeps whatever plugin's editor-event
listener is watching told which file the user is in — the selected tab of the focused center group,
whatever renders it, derived in a store selector rather than read out of the layout tree by hand — so
presence follows a tab switch and not only a Monaco selection. It reports through
`transport/editorReports.ts`'s generic emitter regardless of which (if any) plugin is listening.
`ClaudeLauncher`, the Claude-colour tab mark, and the launch-command-in-a-terminal-of-this-group behavior
described in an earlier revision of this section moved to `@thinkrail/plugin-claude-code`: the
centre tab strip's actions row renders `ctx.workspaceAction` registrations generically now (`workspaceActions.map` in `WorkspaceWorkbench.tsx`), and a tab's icon/adornment comes from `ctx.tabDecoration`
the same way — this module owns the generic slot, not any one plugin's contribution to it. See
`module-plugin-claude-code` for what fills that slot today.

The layout persistence boundary is `layoutState`, not the store. Browsers qualify state by backend endpoint and frontend-surface identity; native windows use the injected stable string adapter's profile/window scope with a fixed key independent of the host's dynamic port. Both paths persist and decode the same bounded document. State is schema-validated on load and restored on reload or supported window-session restoration. Simultaneous windows do not observe each other's storage writes. A surface with no valid local document starts from the Balanced frame; old host snapshots and old browser attention keys are never read.

Project/file/change/review/chat/terminal views receive only resource identity, visibility, and container bounds. Moving a view cannot change module dependencies or make it inspect the frame. A terminal body mounts only while that terminal is locally selected in a visible, unfolded group; hidden terminal tabs stay unmounted while their host PTYs continue running.

Every async resource/session/catalog hydration checks connection generation, workspace lifetime, and the current local frame/view identity before installing data or a follow-up placement. A peer-created chat remains discoverable through host history but does not open a local tab. Host terminal catalog membership is shared: reconciliation removes dead local references and places a newly discovered catalog tab into a compatible local terminal slot without changing frame geometry or stealing attention. Explicit terminal close remains host-domain lifetime and converges removal in every surface.

Default-terminal creation no longer depends on a host layout revision. The workspace-creation flow carries a host-owned pending marker; the host reserves the deterministic process-free terminal catalog entry and clears the marker only after durable success. Each frontend then places the catalog tab locally, normally into its bottom slot; PTY attach still waits for the visibility gate.

## Layout settings

Built-in presets remain web-owned. The Layout section presents built-ins plus the host-synchronized custom preset catalog, while default preset selection, independent side/bottom limits, and whether a click previews are local to this frontend surface. The selected default is the explicit Reset frame target; it is not reapplied on workspace switches because every workspace shares the current frame. Capture/rename/delete changes only the shared custom definition. Apply or Reset replaces this window's frame and reflows all retained workspace views, preserving resource identities, then persists locally; another frontend is unaffected.

## Long-operation feedback

Starting an agent session is seconds-long (watcher readiness + `session.create`), so it is never silent:
every chat-start path — the empty-center New-chat button, `NewWorkspaceDialog`'s create-and-kick-off flow,
and reopening a closed chat (`openChatInTab`) — brackets its request with the store's per-workspace
chat-start counter (`beginChatStart`/`endChatStart`, a counter because starts can overlap); worktree
creation does the same per-project (`beginWorktreeCreation`/`endWorktreeCreation`), which `ProjectTree`
renders as a pending row under the project — the list stays put and the new worktree lands where the
row was. Consumers show it as an inline pending state where the result will appear: the empty-center button flips to a disabled
spinner ("Starting chat…", also the double-click guard), and the chat-history trigger spins while a
reopened chat hydrates. Workspace removal drops the counter with the rest of the per-workspace state.

## A rail that opens on something worth reading

The Balanced preset puts Specs first in the right rail, which is right for a repository that has a spec
graph and wrong for one that has none — the pane opens on its own empty state, and that is the first thing
a new project shows. So a workspace whose spec graph comes back empty moves the rail's default selection
on to the next tool in that group. Specs stays docked and one click away; only what opens by default
changes.

It is a correction rather than a preference because the default is *seeded*: `reconcileAttention` records
the first tab of every group as its selection when the document is reconciled, well before the spec graph
has been read. So the answer is applied once per workspace, when the graph first arrives, and only to a
group still showing what was seeded. Anything the user selects afterwards is theirs and is never touched.
The graph is already loaded for every workspace (`useWorkspaceSpecs` sits in the workbench, not in the
panel), so this costs no extra read.

A plugin tool gets the same treatment for the same reason: a rail seeded onto a tool whose plugin never
mounted, or whose `SideToolRegistration.railDefault(workspaceId)` explicitly refuses this workspace, moves
on to the next tab in that group. `useRailDefault` (`WorkspaceWorkbench.tsx`) keeps the specs correction
as its own once-per-workspace effect and adds a second, independent one for plugin tools — independent
because "is this workspace specless" and "is this plugin tool wanted here" become knowable at different
times, and gating both corrections on the same readiness signal would block whichever answer arrives
second. The plugin decision itself (`resolvePluginRailDefaults`, `railDefault.ts`) is a plain async
function with no store subscription of its own: it reads `plugins/registry`'s `active` set and the tool's
registration once, at the moment it runs, which is what makes it unit-testable without mounting anything.

The one-shot guard is only marked once a run actually lands, not when it starts: `document`/`attention`
routinely change again (terminal placement settling, other reconciliation) while `resolvePluginRailDefaults`
is still awaiting a plugin's answer, and `useRailDefault`'s effect re-fires for that newer state — its
cleanup cancels the stale run. Marking the guard before the await let that cancellation permanently forget
the workspace was still unanswered, so the correction never landed. Marking it inside the un-cancelled
`.then()` lets a superseded run retry against the state that actually superseded it, exactly once.

## Plugin contributions in the workbench

`WorkspaceWorkbench.tsx` composes the plugin registry's contributions with the five (soon more) builtin
regions of the layout, rather than teaching the layout engine about plugins directly:

- **Tool catalog:** `buildLayoutToolCatalog(selectToolCatalog())` composes the builtin `LayoutToolCatalog`
  with plugin-declared side tools (roster order), passed to `<Workbench catalog>` so every tab label, icon,
  and reveal menu the engine renders already includes plugin tools — dormant ones included, as a disabled
  placeholder rather than absent. `renderToolBody`'s `default` case resolves the tool against that same
  catalog and renders `panels/PluginToolBody`, which looks up the tool's *mounted* registration
  (`selectSideTool`) separately — the catalog entry alone cannot say whether the plugin's web module is
  currently mounted, only whether it is declared. `PluginToolBody` wraps a mounted component in the same
  `QuietScrollArea` the `projects`/`files` builtin cases get directly in `renderToolBody` — a plugin side
  tool is a sidebar pane like any other, and a plugin package cannot reach `apps/web/src/components` itself
  (forbidden dep, `plugin-spec-dialect/SPEC.md`), so the host supplies the scroll surface the way it
  supplies the tab chrome around every tool.
- **Tab decorations:** `renderTabIcon`/`renderTabAdornment` try the builtin per-kind cases first (the
  external-file badge, the dirty dot, review flags, …) and only then ask
  `selectTabDecorators()` — first non-null registration wins, built from the same `TabRef` for both the
  icon and the adornment slot, so one decorator answers for a tab's icon and its badge together, not two
  independently-timed guesses. The Claude terminal/tool-tab mark was the last builtin case here; it
  moved to `@thinkrail/plugin-claude-code`'s own `ctx.tabDecoration` registration, so every case this
  method tries first is now generic, plugin-agnostic chrome — nothing here names a specific plugin.
- **Center actions:** `renderCenterActions` appends every `selectWorkspaceActions()` component after the
  chat-history button and new-terminal button, keyed by the action's own `id` (an action
  belongs to one plugin and that plugin does not register the same action id twice, so no separate
  plugin-id tag is needed here the way `selectCompanions`/`selectTerminalAccessories` need one for a table
  that can hold several plugins' rows under the same key).
- **Binary tabs on rehydrate:** the reconnect-time effect that restores tab content after a document
  arrives without its resources cached now asks `selectFileViewer(path)?.read === "none"` before reading
  text — a pdf/image (or a plugin's own no-read viewer) installs with empty content instead of a decoded-as-UTF-8
  binary read, the same rule `openTabs`/`FilePane` apply when the tab is opened fresh.

## Companions

`ChatHost` and `panels/TerminalWorkbench` both wrap their body in `panels/Companions`
(`<Companions host={{kind, workspaceId, key}}>`), which renders whichever registered `CompanionRegistration`
for that host kind is both available and not folded into a chip — `plugins/SPEC.md` owns the full
contract; this is the shell-side wiring, replacing the terminal-only `useTerminalCompanion` hook and
`ChatHost`'s own inline blueprint-only equivalent with the one generic component.

A drag that began in a document used to sweep up everything it passed: tab labels, the model and effort
chips, view toggles, the rails. One copy then carried the interface along with the text. The workbench is
unselectable by default and the surfaces that hold content opt back in — the editor, the terminal, both
prose skins, form fields, and anything that marks itself `data-selectable`. It is a default and an
allowlist rather than a growing list of `select-none` call sites, because the list of chrome only ever
grows and each addition would have to remember.

What this is not is a lock: everything a user means to copy is still selectable, which is what the
allowlist is for. A new surface that holds text the user might want gets `data-selectable`, and the e2e
suite's own selection tests (review commenting, the IDE-bridge selection report) are what catch a
surface that was left out.

## Panes that need git

Changes and Review are windows onto git history, and a workspace can have none — a project folder that is
not a repository, or a repository before its first commit. Both then answer nothing, and the pane used to
say so as a red *Could not read the changes* error, which reads as a fault rather than as the ordinary
state of a fresh folder.

- **`Workspace.vcs`** (`"none"` / `"unborn"`, absent otherwise) is the host's answer, live rather than
  stamped — a first commit clears it — and the shell reads it for the active workspace only.
- **While it is set, neither tool is offered**: `unofferedTools` withholds them from every reveal menu, so
  they cannot be opened. A tab a preset already placed stays and renders a one-line explanation naming
  which of the two states it is in. A plugin side tool declared `requiresGit` in its manifest (the branch
  graph) is withheld and explained the same way.
- The panels themselves are untouched: this is the shell declining to ask, not a new mode inside
  `ChangesPanel` or `ReviewPanel`.

## Error resilience

Every independently mounted workbench resource body—including documents, terminals, and singleton tools—has its own keyed region boundary, so one bad lazy panel cannot blank workbench chrome, sibling groups, or shell. Switching workspace or resource resets stuck region errors. Failed dynamic chunks offer a page reload rather than retrying the same stale module. `main.tsx` retains the last-resort boundary around `Shell`.

Invalid local layout state falls back to the Balanced safe frame without contaminating domain state. A local persistence failure leaves the live frame usable and reports one actionable error. A custom-preset settings failure leaves both the instantiated current frame and catalog unchanged.

A chat tab whose session isn't in the local runtime cache yet renders the same content skeleton as every
other restoring resource — never a manual "Retry" affordance up front, because `chatReconciliation`'s
placement/catalog convergence already auto-hydrates it in the overwhelming majority of cases within a
second or two, and a retry button shown immediately reads as "this failed" for what is normal loading.
`ChatResourceBody` only swaps the skeleton for an explicit retry message once hydration has stayed
stalled past a short grace window (`CHAT_RETRY_DELAY_MS`), so the retry affordance surfaces solely for the
genuinely-stuck case it exists for.

## Chat title controls

A chat tab's existing context menu gains **Rename chat**, and every row in the workspace's **Recently
closed** chat menu gains a visible pencil action. Like workspace rename, each action replaces its own label
in place with a chrome-less single-line input carrying the same typography and geometry; the field is
prefilled, focused, and selected. Enter or blur commits, Escape cancels, and blank, over-80-character, and
unchanged values never issue a request. Keyboard commit/cancel restores the replacement tab or history-row
control; pointer blur preserves the user's new focus target. The named, viewport-bounded interactive history
popover remains open and scrollable while its row is edited. The controls render only when the welcome
protocol supports `session.rename`.

The shell injects the chat-only mutation callback into the otherwise domain-neutral Workbench tab menu rather
than teaching the pure layout engine how sessions are persisted. A commit has no optimistic domain write: the
inline editor returns to the prior host-owned label until the existing `session_info_changed` store fold
updates open tabs and closed history everywhere; rejection retains that snapshot and raises the standard
error toast. Renaming a closed chat does not open or select it; renaming an open chat does not change placement
or focus. Automatic title arrival uses this same label fold but opens no editor, notification, or focus
transition. ChatView's `/name` command is the independent keyboard entry point to the same wire mutation.

## Global chords

`useGlobalHotkeys` remains the one capture-phase owner of app-wide chords. It routes commands through the workbench command surface rather than imperative feature-panel refs:

- `Ctrl+R` opens chat history for the locally selected chat, or the workspace's most-recent chat fallback;
- `Mod+B` toggles the left side, restoring local group/tab attention or an eligible singleton tool;
- `Mod+J` does the same for the right side;
- `Mod+Shift+J` toggles bottom, restoring local bottom attention, a bottom-targeted singleton, or the terminal creation surface.
- `Mod+F` opens the shell's own **`FindBar`** everywhere the focus is not inside a Monaco editor — a
  markdown preview, a rendered diff, a PDF's text layer, the chat, a terminal. Monaco keeps its own find
  widget, so inside an editor the chord is left alone. The bar walks the document's visible text nodes
  itself (a `TreeWalker`, case-insensitive, its own input excluded) and paints every match through the
  CSS Custom Highlight API (`::highlight(thinkrail-find)` / `-current` in `index.css`, on the selection
  tokens), falling back to selecting the current match where `CSS.highlights` is missing. Painting a
  highlight never moves focus or the selection, which is why `window.find` was rejected: it matches the
  query inside the bar's own input and steals the caret. Enter / Shift+Enter step with wrap, a count
  shows `i/n`, the border turns error-red on no match, Esc closes and clears the paint. It exists because
  the desktop shell has no browser find bar at all, and in a browser tab it replaces the browser's, which
  never reaches a Monaco-rendered file anyway. The bar is portalled into the layout group (`section
  [data-group-id]`: center, side or bottom) that held focus when the chord fired, so it sits over the
  pane being read rather than over whatever happens to be at the window's top-right corner; with no
  focused group it falls back to a fixed position in the window. Ceilings: the whole document is
  searched, not the anchoring pane, and a match spanning two text nodes is not found.

- `Mod+Shift+F` opens the **`SearchOverlay`** popup: one query over the whole active worktree, results
  grouped by file, a click opening that file at that line (`requestFileLineFocus`, the same focus channel
  the JSON key jump uses — see [[submodule-web-panels]]). It takes the chord before `Mod+F` does and works
  inside a Monaco editor too, because searching the workspace is not the same request as searching the
  buffer you are in. With no active workspace the chord neither acts nor swallows the browser's.

**The topbar's branch is a control, not a caption** — and it has to look like one. It carries its own
branch glyph and a chevron and lights up while open, because sitting in a row of plain scope captions it
was read as one more label; the affordance is the whole point of moving the branch name here. It opens the
project's local branches, each showing
the worktree path occupying it when one does, so "which of these is a live workspace" is answered by
looking rather than by remembering. A branch can be deleted from there, and two of them cannot: the
branch a ThinkRail workspace is living on, and the one currently checked out — both refused with the
reason on the control, and refused again by the host, which is where the knowledge actually is. Every
deletion asks first, because a branch is the only copy of whatever only it points at. The list is
re-read on every open and whenever the project's workspaces change, since a branch gains and loses its
worktree behind the popover's back. The header carries a **Fetch**, the way an IDE's branch popup
does — every remote brought up to date, nothing local moved, no pruning — because the question "is this
branch still the one upstream has" is asked here, and the answer was previously only obtainable outside
the app.

**"from main" says what it means on hover.** The scope line reads *workspace · from main*, which is a
preposition and a branch name with nothing joining them — it is the ref the worktree was cut from *and*
the ref its changes are measured against, and neither is guessable from three words in a topbar. The
tooltip says both. The line itself stays short, because it is read far more often than it is asked
about, and it takes no selection of its own — it explains the workspace rather than offering a string to
carry away.

**Settings answer to ⌘, on macOS, and to nothing anywhere else.** It is the Preferences chord every Mac
app has, so a Mac user presses it before looking for a button; on Windows and Linux there is no equivalent
convention, and inventing `Ctrl+,` would take a chord the browser and the terminal may want for a shortcut
nobody there is reaching for. It opens the pane the dialog last showed, the way a Preferences window comes
back where it was left, and it does nothing while another dialog is open.

Letter chords match physical `KeyboardEvent.code`, never layout-dependent `key`. The three layout chords remain app-owned inside xterm, do not repeat, and are suppressed while a modal dialog is open. With no active workspace, right/bottom chords neither act nor swallow the browser chord; Projects remains available. Terminal `Ctrl+R` still belongs to xterm; `Ctrl+Shift+R`, macOS `Cmd+R`, F5, and browser reload remain untouched. All other arrangement operations are exposed by the layout command/menu system in [[submodule-web-shell-layout]].
