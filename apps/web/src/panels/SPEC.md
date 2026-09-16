---
id: submodule-web-panels
type: submodule-design
status: active
title: panels — feature views
parent: module-web
depends-on: [module-contracts]
references: [central-integration]
tags: [v1, ui]
---

## Responsibility

The layout-agnostic, store-driven feature views. A panel fills its container and never knows its
arrangement (so the mobile shell is an additive layer, not a rewrite).

Changes and Review keep their fixed toolbars outside a panel-owned `components/QuietScrollArea`; Projects,
Files, and Specs expose content for the shell-owned scroll wrapper described in `shell/SPEC.md`.
`TerminalInstance` wraps xterm with `QuietScrollFrame`, which skins xterm's descendant custom scroll control
without shrinking its hit target; top/bottom state comes from xterm's public `buffer.active.viewportY/baseY`
and `onScroll`/`onWriteParsed` API rather than pretending its non-native viewport has DOM scroll metrics.
Those edges also authoritatively signal whether vertical scrollback exists, allowing the frame to expose
xterm's otherwise-invisible controller for local intent and accessibility modes without inventing a second
scroll model. The same neutral intent-revealed thumb + directional curtains therefore follow the terminal
wherever it is placed. Feature views never receive or derive left/right/bottom placement to achieve that
treatment.

## Boundary

- **Owns:** `ProjectTree`. It takes one optional render prop, `renderWorkspaceTabs(workspace)`, whose result
  hangs under that workspace's row as plain indented rows (`workspace-tabs`), and the workspace list
  switches from spaced rows to hairline-divided ones (`rack`); only the selected tab draws a rounded,
  bordered box (the strip's `nested` row style, with tab groups rendering as one unified bubble that highlights
  as a whole on hover), so the tree reads as shelves with one thing picked
  rather than as nested guide lines or stacked boxes with doubled edges. The shell uses it to
  put a workspace's open tabs and start actions in the tree when vertical tabs are at home in Projects
  (`shell/SPEC.md`, `ProjectsTool`); the tree itself never reads layout state. Each top-level project row is a compact 28px IDE-tree row:
  **always-visible chevron** + folder/name + a collapsed-only plain workspace count (a bare digit, so its
  tooltip says what it counts: "3 workspaces") + an **always-visible Create
  workspace `+` in a fixed right-edge column**. That `+` is the **same control as the Projects-header Add
  project `+`** — both are `Button variant="ghost" size="icon"`, so they render identically and their glyphs
  line up on one vertical axis (both sit at the row's `pr-xs` right edge).
  Long names truncate before the count/action; there is deliberately **no visible Close or overflow icon**.
  Hover highlights the full row and the highlight remains while its **project context menu** is open.
  Right-click opens that PR-#167-styled menu at the pointer without selecting/navigating; a scroll-cancelled
  ~700ms long press is its touch equivalent. With a project-name button focused, the standard Context Menu
  key or Shift+F10 opens the same menu for keyboard-only use; arrow/activate/Escape keys work normally.
  The menu is neutral: **Plus Create workspace**, **FolderOpen Open existing worktree…**, separator,
  **X Close project** — the first two only for a project with a real git repo (`project.hasGit === false`
  hides both plus the separator, since a plain folder has nothing for `git worktree add` to attach to;
  its Default workspace is the only workspace it will ever have). Create is exactly the direct `+` flow. Open existing worktree opens the
  `ExistingWorktreeDialog` chooser fed by `workspace.listExisting` (branch + absolute path per row;
  detached-HEAD rows stay visible but disabled); choosing one calls `workspace.openExisting`, then expands
  the project and activates the attached row without starting a chat. Close
  opens a centered, neutral `ConfirmDialog` titled **“Close {name}?”**, description **“Removes this project
  from the open projects list. Its repository, workspaces, chats, and running activity are kept. Reopen it
  from Add project → Recents.”**, Cancel initially focused, and **Close project**; Cancel, backdrop, and
  Escape dismiss. Confirm fires `project.close` and waits for the full `project.updated` push—no optimistic
  removal; success is the
  row disappearing with no toast, while rejection keeps it and raises an error toast. Menu/dialog dismissal
  restores the source project-name focus; successful close focuses the fallback project name or the Projects
  view's Add project control. `ProjectTree` also owns the `NewWorkspaceDialog` the per-project `+` opens **and** each
  workspace row's hover-revealed **kebab menu** (`MoreVertical`, controlled `DropdownMenu`) — right-clicking
  anywhere on the row opens that exact menu at the kebab without selecting/activating the workspace, while
  the kebab remains the touch and keyboard-focus path. Its actions are a `DropdownMenuSub` **"Open in"**
  (rendered only when at least one editor was detected), **Copy path**, and **Reveal in file manager**. A
  ThinkRail-managed worktree additionally gets **Rename** when the connected host's protocol is at least
  `WORKSPACE_RENAME_PROTOCOL_VERSION`, plus **Remove workspace**; an external row gets only **Remove from
  ThinkRail**, whose confirm promises the checkout and its branch stay untouched.
  The Default gets neither mutation. "Open in" comes from the host-wide `editor.list`; GUI entries call
  `workspace.openIn`, while terminal-kind Vim activates the workspace and runs through `addTerminal`'s
  one-shot `initialCommand`. Copy writes `worktreePath`; Reveal calls `workspace.reveal`.
  Rename replaces the row's name span in place with a chrome-less single-line input carrying the same
  typography, colour, and geometry; it is prefilled, focused, and selected. Enter or blur commits, Escape
  cancels, and blank or text unchanged from the edit-start label exits without a request, so an incoming
  peer snapshot cannot be reverted by closing an untouched editor. A changed commit made while the current
  socket's capability is unknown stays pending and dispatches only after a v55-or-newer welcome restores
  `canRename`; an older host never receives the method. A commit leaves optimistic domain state out of the
  client: the row returns to the prior host-owned label until every surface adopts the full-snapshot
  `workspace.updated` push; rejection keeps that snapshot and raises an error toast. The Git branch and
  worktree folder never change. Remove is styled destructive
  and opens a centered `ConfirmDialog`; confirming fires `workspace.remove` and lets every client react to the
  host's `workspace.removed` push via the store's `applyWorkspaceRemoved`; a rejected request (no event will
  come) surfaces an error toast, leaving the row in place. Each **workspace row** is **two-line**: the display
  `name` on top with the git **branch on a second line beneath it** (muted, monospace), always rendered —
  the display name is decoupled from the git branch (see [[submodule-server-workspaces]]), so which branch
  a worktree is on is answerable from the rail alone rather than only when the two happen to disagree. A
  worktree checked out off a branch carries the literal `HEAD` as its branch and reads **"detached HEAD"**
  (`workspaceBranchLabel`, shared with the top bar's `scope-branch`); a *folder* project with no git at
  all reports the same literal, and its Default row prints it verbatim, because there it means "this
  folder has no branches", not "detached".

  **One decoration class, and only one.** Workspace rows deliberately show **no `+N −M` change badge**:
  the Projects view is for navigation and identity, and change detail stays in the dedicated Changes
  views. The single admitted exception is the **activity glyph** — live agent state — because it is the
  answer to a question the rail is the *only* place to ask: "what is happening in the workspaces I do not
  have open?" Without it the user must open every workspace to find out, which is navigation, not detail.
  A `+N −M` badge fails that test (the Changes view answers it better and the rail cannot show it
  truthfully without watching every worktree), so the rule stands for everything else.

  **`ActivityGlyph`** renders it: a `size-14` Remix line icon in a `size-20` box, keyed by
  `ActivityStatus` — `RiRecordCircleLine`/`text-feedback-info` (running),
  `RiQuestionnaireLine`/`text-feedback-warning` (waiting), `RiErrorWarningLine`/`text-feedback-error`
  (failed), `RiTimeLine`/`text-text-subtle` (queued). Presentational and props-driven; the rollup arrives
  as an `ActivityRollup` from the store's pure `workspaceActivityRollup`/`projectActivityRollup`, which
  `ProjectTree` calls against its one stable `activityByWorkspace` subscription — a rollup returned *from*
  a Zustand selector would be a fresh object every store change and re-render the whole rail.
  - **Icons, not coloured dots** (`.review-thread-dot`'s 6px circle was the alternative): five states
    encoded purely in hue fail colour-blind users and the shipped high-contrast themes. Shape carries the
    meaning; colour reinforces it.
  - **`running` is `feedback-info`, never the accent.** The active workspace's icon and name already
    render `text-primary` on these very rows, so an accent-green glyph would read as selection.
  - **No motion.** The rail is permanently in peripheral vision, and several concurrent runs pulsing out
    of phase read as flicker. The chat plan pane keeps its pulse — that surface is actively read.
  - **Idle draws nothing at all** (`ActivityRollup` is `null`), so a quiet rail is byte-identical to the
    pre-feature one; twenty idle workspaces wearing twenty glyphs would destroy the signal.
  - It sits in **its own flex column between the identity button and the kebab**, so the hover-revealed
    kebab never covers it (a trailing overlay would).
  - **Hover explains it**, via `IconTooltip` (`wrapTrigger` — a bare glyph is not focusable). One busy
    chat shows the plain label; several show a per-state breakdown with counts in rollup order — the same
    **`ACTIVITY_STATUS_ORDER`** the store's rollup uses (imported, not re-declared, so the two never drift) —
    which is where the counts the row itself refuses to carry actually live. "Several" counts **chats**
    (`activityChatCount`), not distinct statuses: two chats both working must read "2 chats working", so a
    threshold on the number of breakdown *lines* would silently drop the count in exactly the
    single-status case. The tooltip is an *enhancement*: the
    same text is always the glyph's `aria-label`, because Radix tooltips are hover/focus-only and a phone
    has neither.
  - **Both** row kinds carry **`data-activity`** (absent when idle) as the e2e hook — workspace rows and
    collapsed project rows alike, on the row rather than the glyph, so the status has one home in the DOM.

  **Project rows carry the rollup only while collapsed**, matching the collapsed-only workspace count;
  expanded, their workspace rows already say it. The **Default workspace**
  (`kind === "default"` — the project folder itself) renders **pinned first** (the server pins it in
  `workspace.list`; `addWorkspace` appends created worktree rows after it), with a **`House` icon** in
  place of the `GitBranch` glyph and **no Rename or Remove item** (non-renamable/non-removable — the server
  enforces both; the menu simply omits them) — it still gets "Open in" / Copy path / Reveal like every
  worktree. Its branch line
  shows the folder's real current branch. When the **selected project's** authoritative workspace list lands,
  `ProjectTree` fire-and-forgets transport's `prewarmWorkspaceSkillLoad` for at most the first eight rows:
  the common visible set begins the conservative watcher-readiness window before a workspace click. The
  per-selection cap bounds the request fan-out; the *global* bound is host-side — prewarm-only watchers live
  in a capped, evictable pool (server `watch` SPEC), so clicking through many projects in one host lifetime
  reuses that pool instead of accumulating watchers. The list never waits for prewarm, failures stay
  silent and retryable by the eventual chat load, and merely expanding a background project does not prewarm
  it (the prewarm is gated on the *selected* project, so the lazy restored-expansion fetch below keeps this
  invariant too). **Rail expansion is store-held, per-browser view state**
  (`store.expandedProjectIds`), not component state: it survives the Project-Home/workspace remount
  boundary and, via the `projectExpansion` persistence module (localStorage under a host-qualified key,
  hydrated at boot from `main.tsx`, best-effort writes, untrusted reads), a page reload — the rail
  looks the same after reloading. Rows whose persisted expansion outlives this client's fetched lists
  (a fresh reload) fetch their missing `workspace.list` lazily; an already-fetched list is refreshed on
  an explicit expand gesture and by transport after a new welcome/reconnect generation, never refetched in
  a loop. The active workspace must
  also stay visible: when `ProjectTree` mounts with an active workspace, or the active workspace's derived
  owning project changes or first becomes resolvable, it expands that parent project — this reveal applies
  *on top of* the persisted baseline (a persisted collapse never hides the active workspace). A manual collapse
  remains respected while the owning project is unchanged; ordinary `workspace.updated` snapshots and
  same-project workspace switches do not force it open again. Navigation restore is neutral: a reload
  re-selects the routed project without touching expansion (the persisted state *is* the view). Workspace
  creation expands its project
  explicitly. Selecting or creating a workspace also selects its owning project, keeping project-home and
  active-workspace context coherent even when the create dialog's project picker targets another project.
  **Opening a project lands on that project's Welcome** — deliberately **no auto-enter** into any
  workspace: Welcome is the fork where the two working modes (isolated worktree vs the project folder's
  Default workspace) are presented as an explicit choice (see `WelcomePanel`), so opening and the
  "project home" gesture converge on the same surface. Opening goes through the shared
  **`useOpenProject`** hook (reused by `ProjectTree` **and**
  `WelcomePanel`, so the flow is identical in the Projects view and the Welcome screen): `project.open` reactivates
  a closed known path under its same id (or opens a new one), then the initiating client selects Project
  Home while every client receives `project.updated`. A git repo and a plain folder open the same way —
  there is no init offer to accept first (`projects/SPEC.md`: `openProject`
  no longer requires a repo, and stamps `Project.hasGit` from what it finds). On failure `project.inspect`
  classifies *why*, so a **`NoticeDialog`** carries a specific reason (missing folder, not a folder, or
  the raw error) rather than a silent no-op. The native picker remains the local fast path and keeps its raised
  timeout because it waits on a human; if the host cannot present it, the rejection instead opens an
  **Open project from host path** dialog carrying the reason and an autofocused path field. The dialog says
  the path belongs to the computer running ThinkRail, accepts a host-absolute path or `~` / `~/…`, and
  submits through this same open/inspect flow. **Enter host path…** is also always present beside Open
  project in `AddProjectMenu`: a remote client cannot tell whether a successful native picker opened on an
  unseen host display, so recovery cannot be failure-only. Every open gesture starts one client-wide
  last-intent generation shared by both mounted `useOpenProject` instances. The flow rechecks that generation
  after each picker, open, inspect, and adoption await, so a manual path or recent selection from either
  surface supersedes any older flow before it can select a project or raise a stale dialog.
  These are modals on `components/ui/dialog`; `NoticeDialog` remains the single-button
  surface for failures with no recovery inside that notice. The hook returns a `dialogs` node each consumer
  renders. **Selecting a
  project** (clicking its row — the chevron expands/collapses separately) **deselects any active
  workspace**, so the shell returns to that project's Welcome — a deliberate "project home" gesture. Both
  select-project gestures — the rail row click and adopting a just-opened project (`ProjectTree` *and*
  `WelcomePanel`) — also **reveal the project's workspaces** (`selectProject(id, { reveal: true })`): a
  gesture that enters a project promises its workspace list, so opening from the Welcome screen never
  lands with a collapsed rail row; the
  workspace's frontend-local view survives through shell layout persistence, so re-selecting it restores
  that window's resource tabs inside the unchanged frame. The round trip unmounts the workspace surface, but
  terminals keep no client-side lifetime to lose: the host owns
  each tab and PTY, and unmounting kills nothing. Several distinct terminals may be visible in different
  workbench groups; the shell layout visibility gate mounts one body for each locally selected terminal
  identity and no inactive body. `TerminalWorkbenchBody` receives its New-terminal callback from the shell,
  so it stays arrangement-agnostic while a center placement can capture its owning group. Host attachment
  remains globally exclusive per identity, so selecting the
  same terminal in another client triggers the existing takeover/detached/reclaim flow. Terminal catalog
  hydration is connection-generation stamped, and its full-snapshot push subscription is established before
  `terminal.list`: a push that lands after the read starts wins, while the transport's synchronously replayed
  cached push is correctly treated as the read baseline. Only explicit `terminal.close` kills a PTY, with the existing busy-shell confirmation; confirming a force-close retains
  the active request until it settles (the dialog may close, but a second request cannot orphan it), failures
  surface to the user, and an authoritative catalog removal dismisses a now-stale confirmation instead of
  leaving a modal for a terminal another client already closed. Also `FileTree`, `SpecsPanel`, `ReviewPanel`,
  `ChangesPanel` (the changed files under a fixed **panel-header row** — `h-panel-header-row`
  (`--panel-header-row-height`, currently 32px), shared structural geometry with workbench Group Headers
  and the chat header, not a value pinned here — that says **what** is being diffed via the
  **`ChangesScopeMenu`** scope pill + the shared **`BranchPicker`** target-branch pill, plus the
  **List | Tree** toggle (`store.changesView`, app-wide) switching a flat list and a folder
  **`ChangesTree`**; clicking a file in either opens/focuses its **center Monaco diff tab**, and every file
  row carries the shared **`ChangeRowActions`** menu),
  `FilePane` (+ its lazy `MonacoEditor` / `MarkdownPreview`, plus `Outline` +
  `outlineTree.buildOutlineTree`) + `DiffPane` (+ its lazy
  `MonacoDiff`), plus lazy `TerminalInstance`. The Monaco plumbing both editors share —
  worker wiring, the local loader, the token-driven `thinkrail` theme + the `[data-theme]` re-theme
  observer — lives once in `monacoSetup.ts`; the slim header view-toggle segment (`Preview|Source|Split`,
  `Split|Inline`, `List|Tree`) is the shared `ToggleSegment` — whose active segment reuses the tab
  grammar's `control-bg-selected` (below), never a container surface, so the selected fill survives the
  high-contrast themes where `container-elevated-bg` collapses onto the toolbar surface.
  **A markdown tab has three views, not two**: Preview, Source, and **Split** — the buffer and its
  preview at once, the preview riding the shared embedded-pane primitive
  (`shell/layout/SPEC.md`) rather than a second tab. Closing the preview half returns the tab to plain
  Source, so a fold is a mode change the toggle agrees with rather than a hidden fourth state.
  The `ChangesPanel` secondary toolbar paints **no surface of its own**: like the right-panel tab strip
  it shows the panel's `container-sidebar-bg`, so the two chrome rows read as one continuous surface. The **file-style tree row** (chevron/spacer
  lead, folder/file icon, truncated label, trailing slot; `min-w-0` so a row can shrink when it shares a
  flex line with a trailing control) is the shared **`TreeRow`**, used by both
  `FileTree` and `ChangesTree` so the two trees stay identical. Both trees **compact a single-directory
  run into one slash-joined row** (`apps/web/src`): the run continues only while a directory has exactly
  one child and that child is another directory, and the compact row expands/collapses the deepest
  directory as one unit. `ChangesTree` evaluates this against the changed-file tree; `FileTree` resolves
  only visible compact runs through its existing client-side directory reads, so the wire remains a plain
  immediate-directory listing. The **`+N −M` diff-count badge** is the shared **`DiffStatBadge`**, used
  only inside Changes: the flat list's file rows and the tree's per-file / per-folder counts.
  `ChangesTree`'s tree build + `+/−` aggregation + shared status glyphs live in the pure
  **`changesModel.ts`** (unit-tested; no store/transport — `ChangesTree` is presentational, fed `changes` +
  `onOpen`/`isActive` by `ChangesPanel`), together with the **diff-tab identity + scope vocabulary**:
  `scopeKey` / `diffTabId(workspaceId, scope, path)` / `diffTabName` / `scopeLabel` and the `splitPath`
  used by both the flat list's path rows and the diff header's path chip. The **branch combobox** is the
  shared **`BranchPicker`** (searchable, grouped Remote/Local, current pick check-marked, refreshed on every
  open with an explicit Refresh control as well) — one component for the New-Workspace dialog's *base* branch
  and the Changes header's *target* branch. **Remote is two layers**: one `Remote` parent over a subgroup per
  host-identified remote (`origin`, `upstream`), whose rows show branch names without repeating the remote.
  The full ref remains every row's selection identity, search value, and `data-branch`; the browser never
  splits `remote/branch`, because Git permits `/` in a remote name. Unconfigured tracking refs live under
  `Other` and keep their full ref as the row label. `BranchList.remoteGroups` is additive: against an older
  host that omits it, the picker falls back to one flat Remote group of full refs. The grouped path uses
  nested cmdk groups; the force-mounted parent hides only when cmdk has hidden every child group. A fork
  works two remotes, so a list that shows only `origin` hides the ref it branches from. **Each remote
  subgroup can be collapsed and expanded** through the shared `RemoteGroupHeading` + `useRemoteGroupCollapse`
  (`remoteGroupCollapse.ts`): a collapsed remote's rows are unmounted rather than hidden, its heading is
  `forceMount`ed so cmdk's own empty-group hiding never takes the toggle down with it. Items explicitly
  opt out of inherited force mounting so search still filters refs. The collapsed/expanded state is
  remembered per remote name in `localStorage`, shared by every picker and by the topbar's
  `BranchList` (see [[submodule-web-shell]]) — one preference, not one per surface. The whole state
  *around* it — the list, `refreshing`, `refresh()` — is the shared
  **`useBranchList(projectId, onLoaded?)`** (`branches.ts`, over the offline-degrading
  `listBranchesOrEmpty`), so both pickers are identical **by construction**: the list is **keyed to the
  project** (it clears on a project change, and both reads are generation-stamped, so a switch can never
  offer or land the previous project's branches), **only the initial read degrades** (a *refresh* keeps its
  last good list instead of blanking the picker on a transient failure), and `refreshing` always drives the
  spinner. Initial-load prefetch always offers the non-empty default to the host, which is the authority on
  whether it names a configured remote; this keeps a stale or missing default tracking ref off create's
  critical path without reading the not-yet-rendered branch state. Manual picks prefetch only rows from the
  loaded remote list. A `null` projectId reads nothing — how a closed dialog pauses. Its degraded default is
  `defaultBranch: ""`, **never the literal `HEAD`**: a sentinel that named a ref would be believed — the
  dialog would preselect it and persist it as the workspace's `baseBranch`, and that worktree would forever
  diff against its own head. Empty means "unknown", so `create` omits `baseRef` and the host resolves the
  real branch. Worktree mode also carries a **Name** field (`ws-name`), prefilled from
  **`workspace.suggestName`** with the host's next free `workspace-N` so the user sees the name they are
  about to get instead of guessing it. The prefill is a **placeholder, not a choice**: while it is
  untouched `create` omits `name` entirely — the host allocates the slot and its prompt-driven auto-rename
  still applies (the naming hint says so, and disappears the moment the field is edited) — and once edited
  the typed name travels with `workspace.create`, which locks it against that rename. Folder mode has no
  base to pick, so in the picker's slot it shows the same list's
  **`current`** as a plain "On {branch}" read-out (`ws-current-branch`) — text, not a control, so nothing
  in that slot invites a click that folder mode cannot honour — the two modes each name the
  branch the work will land on, one chosen, one reported. **`WelcomePanel`** is the first-touch surface the shell mounts (centered, left-nav beside it) whenever no
workspace is active. **One hero heading** (`welcome-title`, the topbar's brand styling — accent font,
`text-primary` — enlarged): the **shown project's name**, or `PRODUCT_NAME` when no project is shown —
the wordmark is the empty-state identity, a project's own name is the identity once one is open (so no
separate project eyebrow). **No pitch prose in any state** — the marketing paragraph was removed as
unread; the screen is heading → banners → **one-to-three cards** (icon top-left,
label + explainer bottom-left; the primary is a filled-primary card carrying the stable `welcome-cta`
hook, others quiet `welcome-action`s). Welcome is **the mode fork**: with a project shown it always pairs
**"Start building"** (isolated worktree, primary) with **"Work in project folder"** (the Default
workspace) so the two working modes are a visible choice, not a hidden default — the same pair regardless
of whether the project carries specs, plus whatever `W10` project-scoped actions plugins register (a
plain map over `selectProjectActions`, self-styled by the plugin, carrying `welcome-plugin-action` +
`data-plugin-id` rather than the core cards' hook so a test counting core cards never counts a plugin's —
see below). The cards by state: **no
projects** → **"Open project"** (one card); **project** → **"Start building"** (primary) + "Work in
project folder" + any registered project actions. **"Open project" appears only in the no-projects state** — where it's the
only possible action; once a project is shown, opening another is the projects-rail **"+"** (the same
dropdown), so Welcome stays the *work-in-this-project* surface. That card hangs the shared
**`AddProjectMenu`** dropdown off it (same menu as the projects-rail "+": Open project / Enter host
path… / New project / Clone repository… / Recents). Recents is the store's `recentProjects`: one last-opened path list
containing open + closed records with no status badge; selecting either runs the shared open flow and lands at Project Home, with a
closed record retaining its id and workspace state. `Card` is a `forwardRef` usable as a Radix `asChild`
trigger. **`AddProjectMenu` takes its own `tooltip` and renders it around the trigger, not around the
control**, which is why the rail's bare "+" can name itself: a Radix `asChild` slot clones exactly one
child, so a tooltip wrapper placed between the trigger and the button swallows the trigger's props and the
menu stops opening. The Welcome card passes no tooltip — it is already labelled. **"Work in project folder"**
(`House` icon, matching the rail's Default row) **direct-enters** the Default workspace — no dialog: the
shared `enterDefaultWorkspace` helper lists the project's workspaces, stores them, and activates the
`kind === "default"` row; an older host with no Default row degrades to an error toast. **"Start building"** is the
intent-first framing of the create-and-kick-off flow — it opens `NewWorkspaceDialog` preselected to the
**Isolated workspace** target; *workspace* is the mechanism, not the label. **"Set up
project"** opens the same dialog with an `initialPrompt` seed **and a `promptNote`** — the note is the
card's own copy (the dialog stays skill-agnostic), saying what the seeded command does: the agent drafts
the project's specs, starting from its goal, before building — deliberately **not** an enumeration of
artifacts, since the dispatcher's routes differ (starting-a-new-project stops at goal-and-requirements;
only importing-a-codebase drafts architecture + module SPECs) and the card can't know the route up
front. The seed is the
`/skill:setting-up-a-project` command **with a trailing space** — the same insertion format the
slash-command completion writes (`chat`'s `selectedSlashCommandValue`), so the seeded hero reads as a
*completed* command and the completion menu stays closed over it (pi's parser treats the arg tail as
optional). The command **forces** the setting-up-a-project dispatcher skill to load (pi's skill-command
syntax; expanded on the `session.prompt` path) rather than hoping the model auto-matches it; the dispatcher then detects
new-vs-existing and drafts the specs accordingly (see [[module-thinkrail-workflow]]). **Every Welcome entry point preselects the Isolated
workspace target** — setup included, so spec drafting is reviewable on its own branch like any other work
and the mode story stays uniform; the Project-folder alternative stays one click away in the dialog.
(Uniformity made an opener-chosen target dead API — the dialog owns its target state and always opens
on the worktree side; there is no `initialTarget` prop.) Which
project drives the has-specs states = `selectedProjectId ?? projects[0]`, read reactively (so the visible
nav's selection updates it). Its `hasSpecs` is **fetched lazily** via `project.hasSpecs` for that one
project (a full-tree walk, kept off the connect handshake) — pending until it resolves, so the cards wait
on it. The open-project orchestration lives in the shared **`useOpenProject`** hook
(above), so the Welcome "Open project" card gets the same non-git init/notice handling as the rail.
Above the cards, `WelcomePanel` composes **`ProviderWarningBanner`** — a slim gold banner shown **only when
no provider is connected** ("No model provider connected — the agent can't run") with a **Connect a provider**
CTA that opens Settings → Providers (`store.openSettings("providers")`). It reads `provider.status` (a
provider is "connected" iff any `configured` or Central is connected) on mount and re-checks whenever the
settings dialog toggles or provider configuration changes, so
it disappears the moment the user connects one; a transport error degrades to *not* nagging (offline ≠ "no
provider"). All provider **management** lives in Settings, not here (the always-on strip is gone).

**A spec and ordinary markdown are told apart by frontmatter, never by filename.** `readSpecDocument`
calls a document a spec when its frontmatter carries an `id` *and* a `type` the spec graph knows
(`specTree`'s own vocabulary). A `SPEC.md` with neither is just a file with that name, and a spec living
under any other name is still a spec — which is what the graph already assumes.

**A spec is titled by its frontmatter.** The `title:` a spec declares is the document's name, so the
preview draws it above the properties block and the outline opens with it, pointing at the `title:` line
so the editor jump lands somewhere real. It is an **element**, not a heading injected into the source:
the reviewed render anchors comments to source lines, and a synthetic line would move every one of them.

**`[[id]]` resolves only inside a spec.** Spec-graph links are rewritten to ordinary markdown links under
a `spec:` scheme — react-markdown drops a scheme it does not recognise, so `specUrlTransform` passes that
one through — and the link renderer resolves the id against the workspace's spec graph, which the store
already holds, so no new wire call. A link naming a node this workspace does not have renders disabled
with the id in its title rather than opening nothing. In ordinary markdown `[[text]]` is left exactly as
written, because there it is text, not a reference. The rewrite happens within a line, so the reviewed
path keeps its anchors.

**The strip answers the click; the document follows.** A group's tab strip renders from the selection,
its body from a deferred copy of it, so the new tab paints as selected in the next frame and the document
it names is built after. Measured from the click event to the painted frame, on a document large enough
to take ~100ms to build: **5ms to the tab, ~100ms to the text**. Without the deferral both land together
at ~90ms, which is the lag this exists to remove — `e2e/tab-switch-latency.spec.ts` pins the gap.

An optimistic selection in the strip plus a transition around the store write was tried on top and made
no difference at all (5ms either way), so it is not here: React already paints the strip first once the
expensive half is out of the urgent render. The tab's own scroll-into-view did matter and moved behind a
frame — it reads geometry, and reading it during the click forced the whole document to lay out before
anything could paint.

**The markdown render is memoized here, because the pane around it is not.** `FilePane` re-renders for
reasons that have nothing to do with the text, and every such render was a full re-parse of the
document. The memo wraps the *document's* use of the primitive rather than the primitive itself: chat
renders the same component against a transcript whose scroll anchoring measures what each render
produces, and memoizing there moved the anchors. It only works if the props hold still — the plugin
arrays are module constants, the component map is memoized, and the review path keeps one array per
stamp offset. The heading scan behind the outline is memoized on the same grounds.

**A long document lays out the part you are looking at.** Switching between two large previews was
visibly slow, and the profile said why: every fence was tokenized from scratch (fixed in `lib`'s
highlighter cache) and the whole document was laid out, twice over, because anything that reads geometry
during the switch forces it. The rendered blocks therefore carry `content-visibility: auto` with an
intrinsic size, so the browser skips layout and paint for what is off screen and the cost follows the
viewport rather than the file. Find-in-page, anchor scrolling and the review stamps are unaffected —
skipped content is still found, scrolled to, and queried by attribute.

**The code font is one family, chosen once.** Upstream #431: the code face was fixed, and its ligatures
were off with no way to turn them on. Both are now settings, and the family is *one* family for every code
surface — editor, terminals, diagrams, code blocks — because that is how a developer configures a machine,
and because per-surface fonts are three settings to keep in step for a difference almost nobody wants. It
is applied where they all already read it: the generated `--tr-font-family-code` custom property, overridden
on the root and removed again when the setting is emptied, so the bundled face comes back rather than being
copied into the setting. A family the machine does not have falls through to its own monospace default,
which is the browser's job and not ours to check.

The name is validated, not escaped: letters, digits, spaces, commas, dots and dashes, at most 120
characters. A value that could close the declaration it lands in is refused by the host and by the field,
because this string is written into CSS rather than compared to a list. Ligatures reach both surfaces that draw code:
Monaco takes `fontLigatures`, and a terminal gets them from xterm's DOM renderer, which draws a row as
text rather than a glyph per cell — one of the reasons `architecture.md` Decision #11 keeps that renderer.

**The editor's GPU renderer is asked for, and then asked about.** Monaco ships
`experimentalGpuAcceleration` off, and it stays off here unless someone turns it on: it is experimental
upstream, with gaps around ligatures and some decoration rendering, and the payoff is narrow — scrolling a
large file. Turning it on is not enough to use it. `navigator.gpu` merely
*existing* is not the question: headless Chromium has the object and no adapter behind it, and Monaco's
GPU renderer draws an editor with line numbers and no text there, which is how this was caught. So the
gate is an adapter that actually answers — `requestAdapter()` once at startup, cached — **and** a
`ResizeObserver` that accepts `device-pixel-content-box`, which Monaco's GPU path needs and throws
without: WebKit, which the desktop app runs on, has the adapter and not the observer, so the editor came
up as an error panel there. Everything that fails either check falls back to the renderer that works. A file opened before that probe settles gets the ordinary
renderer, which is the safe direction to be wrong in.

**The Start work dialog phrases its own refusals.** The Isolated option a plain folder cannot offer wore a
native `title`, so the reason arrived on the OS's schedule, in the OS's styling, over a themed dialog. It is
an `IconTooltip` like every other explanation in the app — the label is a `<label>` around an `sr-only`
radio, so only the input is disabled and the tooltip still has a live trigger to hang on.

**`NewProjectDialog`** is the create half of the project verbs, reached from the **`AddProjectMenu`** in
every state (the rail's `+` and Welcome's own Open-project card both carry it) and additionally as a
Welcome **card in the no-projects state**, where there is nothing else on screen to do. It is not a card
in the other states on purpose — the card row is a mode fork, not a command palette, and a global verb
already reachable from the menu does not earn a permanent slot beside it.

The dialog is a parent-folder picker plus a name field, and it **shows the full target path before it
creates anything** — the one thing a "name a new project" box usually hides. `project.create` makes the
folder and `git init`s it with no commit, so the success state says so plainly and points at the missing
first commit rather than letting the user discover it at *Start building* (which now refuses an unborn
HEAD by name — see [[submodule-server-workspaces]]). Its success state used to hand straight to
`BlueprintStartDialog`; that entry point moved with the blueprint plugin (below) and comes back the same
way Welcome's does — a plain map over `selectProjectActions`, rendered beside the "Done" button once the
project exists.

**`CloneProjectDialog`** is the third project door, beside open and create: a repository URL, the
same **`FolderField`** parent picker both dialogs share (it owns the `dialog.selectDirectory` round
trip, its raised human-scale timeout, and the host-vs-local picker-failure wording), and an **optional**
folder-name field: empty by default, labelled as optional, with the URL's last path segment (`.git`
stripped, `git@host:org/repo` handled) as its placeholder — the same placeholder-not-a-choice grammar as
the workspace Name field, so the common case is two inputs, not three. Whatever the field resolves to
(typed, else derived) feeds the target path shown before anything is cloned, exactly as in
`NewProjectDialog`, and always travels on the wire: the host derives nothing from the URL, which keeps
one derivation in one place. A fourth, optional **Depth** field (a number input, "full history" when
empty) sends `depth` for a shallow clone; the dialog disables Clone while the value is not a whole
number of at least 1, and the host checks the same rule again. `project.clone` is long (a real `git clone` over the network), so the request carries its
own ten-minute timeout matching the host's bound rather than the transport default. Success closes the
dialog and selects the new project (revealing its workspaces, like every other adoption); failure keeps
the dialog open with git's own stderr as the reason, since "couldn't clone" hides exactly what the user
needs (a missing key, a typo in the URL, a folder that already exists).

**The Blueprint feature — `BlueprintStartDialog`, `BlueprintView`, `BlueprintControlView`,
`EditableText`, `blueprintOpen.ts` — moved to `@thinkrail/plugin-blueprint`'s own web half.** See that
package's `SPEC.md` for the format's rendering, the start flow, and delivery to the author. What stays
here is the boundary the plugin reaches through: `openFileInTab`'s viewer dispatch (`open`/`raw`),
`FrontmatterProperties` (shared with the markdown preview), `Outline.tsx` and the outline machinery, and
the `documentLink`/`writtenPathGroup`/`fileIcon` slots (`plugins/SPEC.md`). The three hand-wired
`onDraftBlueprint` props this section used to describe (`ProjectTree`, `NewProjectDialog`,
`WelcomePanel`) are gone; the plugin registers two `W10` actions instead — a workspace-scoped one
reachable from within an already-open workspace, and a project-scoped one rendered by `WelcomePanel` and
`NewProjectDialog` from `selectProjectActions`, taking the place the three props used to.

Beneath it, **`ProjectSkillsNotice`** is the pre-workspace trust surface (so trust is reachable with no
workspace yet): **presence-gated** — renders nothing unless the selected project ships committed skills —
showing a **count** ("ships N skills → *Trust project*"), a "N new → *Review & enable*" state for skills that
appeared after trust (`project.acknowledgeSkills`), else a quiet "N trusted" line. It never renders the
skills' (attacker-controlled) names before trust. The full manager (`chat/SkillsDialog` in **project mode**
— trust + group/skill toggles, no session yet) is reached from **New Workspace**, whose opener is the shared
`chat/SkillsButton` primitive (so it cannot drift from the chat header's Skills trigger). This is the
pre-session half of the user's skill settings; the chat header opens the same dialog in workspace mode
(with Reload).

**`NewWorkspaceDialog`** is the start-working surface. Its title is the **mode-independent** **“Start
work”** — the window is one surface, so it does not rename itself under the user. Under it, **a target
control** (a two-option segment — a native radio group, `fieldset` + sr-only `legend` over
visually-hidden radio inputs, so assistive tech hears one mutually-exclusive choice — both always
visible: the two-mode model in one glance) chooses **where** the work runs, and the **one-line
description directly below it** is the only mode-aware prose, stating just the difference: **Isolated
workspace** → **“A separate git worktree on its own new branch.”**; **Project folder** → **“Your project
folder itself. No isolation, work lands on the current branch.”** A project opened as a **plain folder**
(`Project.hasGit === false`) has nothing for `git worktree add` to attach to, so the Isolated option is
**disabled** (`data-disabled`, titled with the reason), the dialog is folder mode whatever the segment
state says (`isolated` is the target *and* the project's ability to isolate — switching the project
picker to a plain folder flips it too), and the description reads **“Your project folder itself. It is
not a git repository, so there is nothing to isolate.”**; the Welcome “Start building” card says the
same in its subtitle instead of promising a worktree. Pinned by `e2e/gitless.spec.ts`. In folder mode the base-branch picker and the naming hint are hidden (nothing is created — submit **enters** the
project's Default workspace via the shared **`enterDefaultWorkspace`** helper (`defaultWorkspace.ts`:
`workspace.list` → fold into the store → activate the `kind === "default"` row, one atomic entry — the
rail's auto-expand follows activation; error toast + `null` if an older host has none — the same helper
behind the Welcome fork card, so the enter + degrade path lives once; **`onCreated` does not fire** —
nothing was created and the helper's list is already fresh))
and the submit button reads **Start** instead of **Create**; the branch-list fetch + background base
prefetch still run (fire-and-forget, keeps a toggle back to worktree instant); the chat
kick-off tail is identical in both modes. **The agent is a choice too, and every choice past "Bundled
agent" is a registered launcher** (`ws-agent`, the shared `chips.ts` look): a **`LauncherAgentOption`**
wrapper renders one chip per `usePluginRegistry(selectLaunchers)` entry, each calling its own
`useAvailable()` so a roster change never varies which component owns which hook — Claude Code registers
its own launcher through `ctx.launcher()` from `@thinkrail/plugin-claude-code`'s web half, so the chip
exists at all only while that plugin is active (off means no chip, not a disabled one), and Blueprint's
own start dialog
reads the same registered launcher rather than a hard-coded pair. With a launcher chosen the pi model and
effort pickers give way to that launcher's own model menu when it declares one (`ws-claude-model`: Default
model or one of the launcher's `models`, sent as `--model`), and create opens **a terminal in the centre
group** running `launcher.terminalCommand({ model, initialPrompt })` instead of a chat — the same
composition the tab strip's launcher and Blueprint's own start flow use. No pi session means no
prompt-driven auto-rename, so the naming hint stays hidden for a launcher agent and the worktree keeps
its placeholder name unless the Name field was edited. `e2e/new-workspace.spec.ts` drives it against a
stand-in `claude`. An optional **`promptNote`** renders as a small info strip above
the prompt. The worktree mode's
base-branch trigger reads **“From
{base}”**, not an unexplained ref. An optional **`initialPrompt`** seeds the prompt hero (still editable;
empty by default); while the prompt is non-empty (worktree mode), a secondary hint says ThinkRail will name the workspace
and branch from the request. The rest stays compact: the base-branch combobox (`git.listBranches`,
degrading to local branches offline; a Refresh re-lists; `origin/HEAD` is filtered so no stray `origin`),
a project picker, the prompt hero, and the reused
  `chat/ModelSelector`+`ThinkingSelector` in **pre-session** mode — preselected to the host's **pinned**
  default via `model.default` so the exact model shows when there is one (values held in dialog state,
  applied at create time). With **no pinned default the host answers `model: null`** and the dialog holds
  none: the picker reads **Default model**, the effort control is disabled (no model, no supported set), and
  create sends neither — so pi resolves both exactly as it does for a new chat tab. The dialog must not
  substitute a model of its own choosing here; one resolver, pi's, see `submodule-agent`. The pickers' popovers portal into the dialog node (so their lists scroll under the Dialog scroll
  lock). Their catalog is the shared one — `chat/useModelCatalog`, so the dialog and the chat composer
  cannot drift — which means it is **live**: the picker's Refresh row can replace the list underneath a
  held selection. The dialog therefore reconciles the held model against it on every change via the pure
  **`reconcileModel`** (model only — effort is decided by the host's clamp, below): re-point to the same
  `{provider,id}` (the refreshed object, whose `thinkingLevels` may differ). What it does when the catalog
  has no such model turns on **`catalogFresh`** — the store's `modelsFresh`, true only for the installed
  result of an awaited forced refresh the host reported **`complete`** (a capped wait can answer with a
  current-but-unsettled list, which is no basis for a verdict), dropped by the next `model.list` install from any consumer (whose
  handler answers from before the detached refresh it starts) *and* dropped up front by any consumer
  activating. On a fresh catalog it returns **`"unavailable"`** — a verdict, not a replacement: the dialog
  then asks **`model.default`** (the host's pinned default or none, plus a consistent effort) exactly as it
  does for the preselect, through **one** `applyHostDefault` — so no client-side copy of the host's default
  policy exists here. Asked at most once per opening, so a still-missing model can't spin the effect. Effort is a separate concern: one effect keeps the held level
  runnable by the held model by asking the host for pi's clamp (**`model.clampThinking`**) rather than
  deciding locally, so an explicit switch and a refresh that shrank a model's set resolve the same way
  pi would. `model.default` needs no adjustment: the host already returns a self-consistent pair.
  On open and project-picker changes, the dialog reads **`skill.list({projectId})`**; whenever a leading
  slash token becomes active it also reads **`template.list({projectId})`**. It feeds both into the shared
  `prompt` module, so Create Workspace and live chat use the same filtering, menu, keyboard navigation,
  race-safe template pick, and Tab-through placeholder state machine. Skills come from the selected project's
  **current checkout** plus personal/bundled sources; templates merge global + current-checkout project scope
  with project precedence. Selecting a skill inserts `/skill:<name> `; selecting a template reads
  `template.get({projectId, name})`, replaces the complete draft with its body, and activates its placeholders.
  Up/Down navigate, Enter/Tab select, Escape dismisses the menu; outside an open menu Tab/Shift+Tab cycle active
  template slots and Escape ends that session. Submission mirrors edited repeated slots and removes untouched
  markers before the finalized text becomes the first prompt. While a selected template body is loading,
  submission is held but the prompt remains editable; editing cancels the delayed apply. Changing projects also
  invalidates an in-flight pick, so a response from the previous checkout cannot populate the next project's
  prompt. The first prompt is snapshotted before asynchronous workspace creation begins.
  Listing/get failures preserve the draft and degrade to whichever source remains available. Extension commands and `/compact` stay absent because no live
  session exists. A caption under the prompt marks the catalog as **from the current checkout** (the created
  worktree's session is authoritative if the selected base branch differs). When the selected project is **untrusted AND ships
  committed skills** (a count from `project.aliasSkills`, never their names), a **trust notice** shows a
  *Trust project* button — the repo's skills stay withheld until granted (`project.setTrust`, which folds the
  updated project back into the store and re-previews); personal + bundled skills show regardless. When the menu is closed, **Enter submits** (matching the submit button's
  `↵` affordance) and
  **Shift+Enter** inserts a newline. Worktree-mode submit = `workspace.create({ projectId, name?, baseRef })` → set active → **always open a
  fresh chat** (`session.create({ workspaceId, model?, thinkingLevel? })` — a held model + effort apply even
  without a prompt, and travel together: with none held both are omitted and pi resolves them) → a typed prompt is additionally sent as the first message (fire-and-forget
  `prompt`); an **empty prompt leaves the just-opened composer ready** — submitting the start-working
  surface always lands the user in a chat, never on a bare receipt (folder mode: the same tail after
  entering Default). A **rejected** kick-off `prompt` (a bad model / missing API key — e.g. picking a
  nonexistent model) surfaces as an `error` turn in the just-opened chat via `store.appendErrorTurn` (with
  `transport`'s `errorText`) rather than vanishing. The two rejections with **no chat to host a turn** raise a
  `store.toast.error` instead: a failed **`workspace.create`** (keeps the dialog open to retry) and a failed
  **`session.create`** (the dialog has already closed, the workspace exists — the toast is the only place left
  to report the dropped kick-off). (`gh` status lives in `SettingsDialog`, not the
  create dialog.) **`SettingsDialog`** is the app-settings surface the shell's topbar gear opens — a
  **store-driven two-pane shell** (left section rail + scrollable content pane; mobile collapses the rail to
  a horizontal segmented strip): `settingsOpen`/`settingsSection` live in the store so the gear AND the
  Welcome banner can open it deep-linked to a section. Live sections: **`ProvidersSettings`** (the in-app
  provider-auth surface — Connected cards each with a **Sign-out only when `canLogout`** (env /
  models.json auth shows a "Managed" tag instead, since the host can't unset it); a **"Sign in with a
  subscription"** block of `canOAuth` providers; an **"Add an API key"** group of `canApiKey`-only
  providers (capped with a "Show N more" expander) — **both routes start `provider.loginStart`**
  (`type` `"oauth"` / `"api_key"`, issue #97) into the same store-driven `auth/LoginDialog` (open the
  URL / paste a code / answer the provider's own key prompts, `provider.loginReply` — no inline key
  field); a "configured outside the app" note for rows with neither flag; and
  the **`JetBrainsAiCard`** — route Central-supported models through the user's JetBrains subscription while
  keeping ThinkRail's embedded PI — a state machine over the typed `JbcentralStatus` +
  `provider.jbcentral*`: absent (official host-OS install guidance + Recheck), outdated — below the host's
  minimum supported Central (guided Update), invalid/unverifiable version (safe guidance, no native action;
  a version *above* the minimum is simply ready, never gated), **signed out** — the card
  **states it and offers only Sign in**: the primary action *replaces* Connect rather than sitting beside it,
  and on `supported` the signed-out line replaces the "Central is ready" claim instead of annotating it. The
  rule is that the card never advertises an action that cannot succeed — connecting without credentials
  fails — so the prerequisite becomes the offer, and Connect returns once the host reports credentials.
  **Signed out renders as one state, whatever the configuration underneath:** the body says only that Central
  is signed out — never paired with a "Connected" line that would contradict it — and **Sign in is the only
  action**, Disconnect withheld along with Connect. Once authenticated, a configured status whose proxy is
  positively observed stopped likewise replaces the success claim with “Central's proxy is not running” and
  offers only **Start proxy**; after it starts, Connected + Disconnect return. The prerequisite order is
  therefore Sign in → Start proxy → ordinary connected controls, never competing actions. Unknown proxy
  health does not manufacture a demand. A broken session asks for the one thing that resolves its current
  prerequisite rather than pairing a fix with an unrelated choice or success message.
  **Signing in is one button, never a menu:** ThinkRail launches Central's flow on the host, and the
  `central login` command appears *only* where that launch failed — printing it beside a working button makes
  the user choose between two routes to the same place. Because the flow opens on the **host's** browser, the
  launched confirmation says so and names Refresh as the next step, since Connect is not on screen yet. The
  *reactive* guidance survives for the case the probe cannot see: credentials present, action refused
  anyway —, sign-in required (launch Central sign-in +
  Retry), ready (Connect), configuring (a Central action or watched candidate rebuild is in flight),
  connected (the current runtime for new work applied Central; Disconnect), load-failed (the last runtime or
  boot-time plain fallback remains usable; Retry or Disconnect), and generic action error (Retry/Recheck).
  There is no restart prompt, affected-chat list, blocked state, or recovery mode. Existing live chats may
  retain an older runtime—including Central after Disconnect—and the card says its state applies to new chats.
  Update/connect/disconnect state is host-authoritative and shared across clients; every mutation re-reads
  `provider.status`, while `provider.changed` invalidations from watched external changes trigger the same
  re-read plus model-list invalidation. Status reads are request-sequenced so an older response cannot replace
  a newer watched/action result. Copy never promises only Claude/GPT, never asks for standalone PI,
  never renders child output/diagnostics/artifact content/paths/proxy data/secrets/raw models, and maps only
  closed reason codes to ThinkRail-authored text. On protocol v59+, the same card always shows the
  synchronized **Show quota in top bar** switch and **Refresh every _ seconds** field, in every Central
  lifecycle state. The flag defaults on; the interval defaults to 30 and accepts whole `1–3600` values.
  Off disables (but retains) the interval. The field edits locally, commits on blur/Enter, reports invalid
  range inline, and waits for `settings.changed` rather than installing optimistic authority. Older hosts get
  neither control. On protocol v67+ (`JBCENTRAL_ACCESS_PROTOCOL_VERSION`), the same card additionally mounts
  **`JbcentralAccessSection`** whenever `isJbcentralConnected(status)` — an account with more than one
  org/workspace can pick which one Central draws AI credits from (issue #433), because `central` itself has
  no in-app equivalent to Air's org switcher. It fetches `provider.jbcentralAccessList` on mount and renders
  each source's display name with a **Switch** button, except the current one (no action — it is already
  selected) and any source whose `selectionId` came back `null` (an unlabeled **"Switch in a terminal"**
  hint with a tooltip instead, because ThinkRail's own recovery of that id is a best-effort read of Central's
  internal debug log — see `packages/shared/SPEC.md` — and can legitimately fail). Fewer than two sources
  renders nothing: there is nothing to switch to. A click calls `provider.jbcentralAccessSwitch`, reloads the
  list on success, and shows a **warning, not an error,** when the switch itself succeeded but Central's own
  required proxy restart did not (the org selection already changed; only the running proxy is stale). A
  failed switch surfaces a plain inline error and changes nothing. Older hosts show no section at all rather
  than a broken one. **`GithubSettings`** (the "Local GitHub" block — `github.authStatus()`
  Connected + login / Not connected + Refresh); **`AppearanceSettings`** (a **Draw the editor on the GPU**
  switch — `editorGpuRendering`, off — above the catalog-driven theme
  settings, gated to fixed-only behavior below `THEME_SYSTEM_PROTOCOL_VERSION`. Current hosts explain that
  the mode/pair follow the user while each device reads its own system setting, then show one accessible
  radio group with top-level `Fixed — Use one theme everywhere` / `Match system — Follow this device`
  cards. Mode is deliberately separate from the manifest list: making System another theme row nests configuration in a
  radio-like option, while always showing all three choices gives inactive values equal visual weight. Fixed
  mode shows the existing manifest list and retained fixed choice. System mode shows appearance-filtered
  `Light theme` / `Dark theme` selectors plus a `Current on this device` row reading
  `<device icon> <Light|Dark> → <palette icon> <resolved label>` — the icons carry which half is the device
  appearance and which is the theme, since both halves are often the same word;
  either slot may independently be normal or high contrast. First enable sends mode + the themes-derived
  same-contrast pair atomically; later slot edits replace the complete pair, and returning to fixed changes
  only mode, preserving both choices. Exactly one theme mutation may be in flight from this panel; its
  controls use their real disabled state until the request settles, preventing rapid complete-pair writes
  from overwriting one another with stale sibling slots. Every action fires `settings.update` and
  **converges on the `settings.changed` broadcast** with no optimistic apply; rejection leaves
  controls/theme unchanged and raises a toast. An unavailable or wrong-appearance configured id is
  disclosed beside the effective same-appearance fallback and is never silently written back. The panel never owns a theme list,
  media-query logic, pair derivation, or fallback — all come from `themes`); **`LineWidthSettings`** (the
  live section immediately after Appearance — one page with stacked **Chat** and **Files** groups. Each has
  a 40–240 integer field with visible `symbols` suffix and explicit Save, plus an independent
  host-synchronized **No bigger than pane width** switch; defaults are 120/on. Invalid drafts stay local
  with an accessible range error; Escape restores the host value, Enter saves when valid, and a changed
  authoritative width from `settings.changed` replaces a stale draft. Mutations converge only on that
  broadcast and rejected calls toast without changing geometry); **`ChatSettings`** (the next live section —
  **Default model** model and thinking effort pickers (`ModelSelector` + `ThinkingSelector` over
  `useModelCatalog`, written via `model.setDefault`, reading `model.default` on mount; placeholder and default
  option restore automatic provider default), **Hidden models** (a pattern input and chip list allowing users to blacklist exact model IDs, globs, or regular expressions from model pickers, displaying matching model counts and managing patterns via `settings.update { hiddenModels }`), **Message order** radio cards over `store.chatMessageOrder` (Oldest first, the compatibility default /
  Newest first, the opt-in), one **Streaming response movement** two-handle range over
  `store.streamingResponseMovement`, then the three existing composer-growth cards. The movement control's
  copy is “Choose when the chat moves while an answer grows and where its newest edge lands”; one axis runs
  Top → Message box, Settle is 25–90, Trigger is 35–100, both step by 5 with a 10-point minimum gap, and
  the displayed default is 75%→100%. It exposes no runway/tail/lifecycle controls. Message order and
  movement both apply immediately and persist only in this client through the chat preference seam:
  browsers use current-host-qualified keys, while a native shell may inject its stable
  backend-profile/window adapter. Another browser, native window, or host is unaffected. Composer growth
  remains a top-level `AppConfig` field and converges on `settings.changed`, with a toast on rejection.
  Labels use “message box” rather than the internal “composer” name when explaining where the user types.
  The final **Subagents** block pairs the host-wide `subagentsEnabled` switch with a named **This workspace**
  `Use global` / `On` / `Off` control when a workspace is active; no workspace means no local block. The
  whole block requires `protocolVersion >= SUBAGENT_SETTINGS_PROTOCOL_VERSION`, so an independently shipped
  client never offers unsupported mutations against an older host.
  Global mutation converges through `settings.changed`, local mutation through `workspace.updated`, and
  neither is optimistic. `Use global` sends `null`, so later global changes continue to flow through);
  the
  **shell-owned injected Layout
  section** (Balanced/Focus/Review
  plus named custom preset cards. Custom capture/rename/delete updates the host-synchronized catalog and
  converges through `settings.changed`; current/default selection and independent side/bottom limits are
  frontend-local. With an active workspace each preset offers confirmable **Apply now…**, which asks shell
  to replace this window's frame and atomically preserve/reflow open resource identities in every retained
  workspace view; no current layout is published); the optional **shell-owned injected Update section**
  (the Settings shell includes its row only when content is provided; `panels` neither discovers native nor
  host update capabilities. If a later welcome removes injected content while Updates is selected, Appearance
  is rendered and highlighted rather than leaving no active row);
  **`TerminalSettings`** — a **Replayed output** size picker (`store.terminalReplayKb`, five presets from
  Off to 1 MB, `settings.update { terminalReplayKb }`, applies to terminals opened from now on) and, on
  Windows hosts at `protocolVersion >= WINDOWS_SHELL_SETTINGS_PROTOCOL_VERSION`, a **Windows shell** picker
  (Auto / PowerShell 7 (pwsh) / Windows PowerShell / Command Prompt,
  `settings.update { terminalWindowsShell }` — see `submodule-server-terminal`'s shell-selection decision
  for what each choice spawns). The protocol gate keeps a newer independently shipped client from presenting
  a setting an older host preserves but does not act on. The Windows-shell
  half is split into a **props-driven** `WindowsShellSettings` component rather than reading the store
  inline like the replay picker: zustand's React binding feeds `renderToStaticMarkup` its frozen
  `getInitialState()` snapshot (`useSyncExternalStore`'s `getServerSnapshot` argument), never a test's
  `setState`, so any settings section that must stay assertable under that render path takes its store
  values as props instead — the same shape `ChatSettings` already uses for `SubagentSettings`; and
  **`TemplatesSettings`** — two groups, **Global** and **This
  project** (the project group renders only with an active workspace), each a header with a **New**
  button plus its rows, fetched via **two independent `template.list` calls** (both refetched whenever the
  store's `templatesVersion` bumps, each with its own failure flag so one's success can never clobber the
  other's still-real failure): unscoped (`{}`) for **Global**, and `{ workspaceId }` filtered to
  `scope === "project"` for **This project**. The unscoped call matters specifically because the server's
  `template.list { workspaceId }` response is **shadow-merged** (`templates.ts`'s `listTemplates`: a
  project template wins over a same-named global one) — right for the composer's `/` menu, but if Settings
  used that same workspace-scoped call for its Global group too, a shadowed global template would vanish
  from view entirely with no way to find, edit, or delete it
  (`data-testid="template-row"`: name + description, and — project rows only — an
  **Open as file** action that opens `.pi/prompts/<name>.md` through the exact same `openTabs.ts`
  `openFileInTab` the file tree uses — at the **`keep`** intent, since a deliberate "open in editor" must
  not land in a preview slot a later click would silently replace — then closes Settings, and an
  **Edit** action; a global template has
  no worktree to open a file tab against, so global rows stay dialog-only). **New**/**Edit** open the shared
  `chat/TemplateEditorDialog` (see `chat/SPEC.md`'s Save-as-template bullet — it lives in `chat/` because
  `HistoryOverlay`'s save-as-template action needs the identical form, and `chat/` can't import
  `panels/`). **Delete** is a `ConfirmPopover` anchored to the row's own Delete button, calling
  `template.delete` directly — the dialog itself is never involved in deletion. **R4 — starter-templates
  offer:** when the **Global** group's fetch has
  resolved with zero rows and no error, its empty state swaps the bare "No templates yet." for that same
  hint plus a button (`data-testid="template-starters"`) — clicking it `template.save`s five verbatim
  starter templates (scope `"global"`, body assembled client-side via
  the shared `prompt` module's `assembleTemplate`, the same helper `TemplateEditorDialog` uses) sequentially,
  then bumps `templatesVersion` once, the same invalidation the row list already refetches on — the
  offer disappears on its own next render once the list is non-empty, no dismiss state to track. The five
  (review/explain/tests/commit/rename) are **the same set this repo checks into its own `.pi/prompts/`**:
  those ship at *project* scope, so only a ThinkRail checkout ever sees them, and "the templates ThinkRail
  ships" must mean one thing rather than two — change one, change the other. The composer's `/` menu
  carries the discoverability half (`chat/SPEC.md`: a `slash-templates-empty` footer nudge deep-linking
  here when no template exists anywhere), since this offer is otherwise two clicks deep in a dialog. **This
  project**'s empty state is unchanged (still the bare text) — the offer is Global-only, since it only
  ever seeds global files. No server change. **`PrivacySettings`** manages additional-data consent and briefly
  distinguishes it from always-on basics; the event contract belongs to [[submodule-server-analytics]].
  **`AnalyticsConsentDialog`** mounts once through shell after a capable host's config hydrates. Its draft
  switch uses the saved preference (absent → off); confirmation atomically saves preference plus
  `analyticsConsentConfirmed`, while dismissal saves off/confirmed. A preselection never grants consent.
  Failed persistence leaves the choice available with an error; broadcast closes it across clients.
  Saved decisions survive restarts and change later through Settings. The startup window focuses on optional
  sharing with brief anonymous/no-personal-data copy and the shared switch; its footer has only **Save choice**,
  while Close, Escape, and backdrop remain dismissals. Full reporting details stay in Settings. Older hosts
  retain their legacy privacy control without the new consent dialog.
  **`ClaudeCodeSettings`** carries the integration switch and the
  **launch command** the tab strip's launcher runs: a free-text field, because the honest value is a
  command *line* — a name on PATH, an absolute path, or either plus flags — with a Browse… button that
  raises the host's native file picker (`dialog.selectFile`) and writes back a shell-quoted path, since a
  browser cannot see a filesystem and a path with a space would otherwise read as two words. The field
  commits on blur or Enter and the host normalises a blank one back to `claude`, so the launcher can never
  type an empty line into a shell. **`FeedbackSettings`** is the final
  live section after Privacy: the same interview copy as the automatic prompt, stating that joining a user
  interview to discuss the participant's ThinkRail experience earns 100 bonus credits in Central
  (JetBrains AI), plus a real external anchor to the fixed Google Calendar booking page, opened in a new
  tab with `noopener noreferrer`. ThinkRail communicates the incentive only; attendance verification,
  eligibility, and credit fulfillment stay outside the app. This proactive Settings link is always
  available and deliberately does not call `feedback.respond`, alter automatic-popup state, or claim that
  booking alone earns credits.
  **`ReviewSettings`** is the
  **plan-review policy** section: the reviewer **model + effort** (`ModelSelector`/`ThinkingSelector` over
  `useModelCatalog`, written as `settings.update { reviewModel | reviewEffort }`; unset ⇒ default). The
  selector carries an **explicit default-model row** (`model-option-default`, labelled with the host's
  `model.default` result) that writes `{ reviewModel: null, reviewEffort: null }` — the null-clears wire
  form, see `submodule-server-settings` — so a chosen reviewer model can be restored to the pi default
  without hand-editing host state; while unset, the effort control runs on the default model's supported
  levels (fetched once from `model.default`) instead of an empty list. And an
  **auto-fix toggle** (`review-autofix-toggle`, a switch over `store.reviewAutoFix` →
  `settings.update { reviewAutoFix }`) — off means a `request_changes` verdict records findings and waits
  (the host gates its auto-fix cycle on it, see `submodule-server-todos`). A single dimmed "General" nav item ("Soon") still signals the shell is
  built to grow. `ProvidersSettings`/`AppearanceSettings`/`LineWidthSettings`/`ChatSettings`/`ClaudeCodeSettings`/
  `TemplatesSettings`/
  `PrivacySettings`/`ReviewSettings`/`FeedbackSettings` and the app-wide **`InterviewPromptDialog`** are the
  panels-owned **integration pieces** (store + transport). The prompt renders the shared incentive copy and
  fixed Calendar anchor with `Schedule an interview`, `Not now`, and `Never show again` actions. Primary and
  middle-button booking activation open Calendar immediately and record `book`; close, Escape, and backdrop record `postpone`; permanent
  dismissal records `never`. The controlled dialog closes only after the host acks, and reports a rejected
  action without discarding the still-open choice. `SettingsDialog` receives the Layout section from the
  shell composition root so no panel reaches sideways into shell, and the `LoginDialog` stays presentational
  (`auth` module).

  Panels compose their own sub-panels
  (e.g. side tools → `FileTree`/`ChangesPanel`, workbench resource renderers → `FilePane`→`MonacoEditor`) — an internal hierarchy.
  When a center group has no resource tab, the workbench asks panels for the empty surface as a persistent
  creation/orientation receipt rather than a generic placeholder: **“Workspace ready”**, the display name,
  `branch · from baseBranch`, and **“Files, chats, changes, and terminals are scoped to this workspace,”**
  followed by the existing **New chat** action. For the **Default workspace** the receipt tells the truth
  instead of promising isolation: **“Default workspace”**, the project name, `on <branch>`, and “Chats,
  changes, and terminals run directly in your project folder.” An **external workspace** reads
  **“Existing worktree”** with `on <branch>` for the same reason — ThinkRail did not cut it, so there is no
  `from <base>` to claim. It is neither one-time nor dismissible, so it also helps
  after the last tab closes without introducing onboarding state. The workbench resource renderer handles
  registered **`plan`** tabs (`PlanTab`) via the lazy **`PlanPane`** — the chat plan's **live review-map
  page**. Frontend-local placement stores only the `todo-plan` resolver kind + session identity, never inline
  plan content; another client can explicitly reopen the same host-owned page without inheriting placement. It renders the session's TODO plan document-scale
  (groups as sections, items with status glyphs) with a **scan-first item anatomy**: the item TITLE is
  the only full-size text (`tr-text-ui font-medium`), every detail is a step down (`tr-text-metadata`,
  subtle/muted) — so titles never blend into prose. A **done item collapses to a compact two-line
  block**: line 1 is a LEADING chevron (matching the change-set disclosure's anatomy; non-collapsible
  rows reserve the chevron's width with a ghost spacer so every title in the list aligns) + the title,
  with the **review slot at its right edge**; line 2 is a quiet meta strip UNDER the title (the
  verification glyph — `ShieldCheck`/`CircleAlert` off `verificationStatus`, `N files`, and — hidden
  below `sm` so the title keeps its width on phones — short sha + `DiffStatBadge`), aligned to the
  title via the same ghost-chevron spacer. The meta lives on its own line precisely so the title row's
  right edge is free for the review slot — the reveal-on-hover action never collides with the title or
  the meta. **The whole row is the hover target** (`group` on the `<li>`, ProjectTree's pattern):
  hovering the row tints it and **reveals `Start review` — WITHOUT changing the row's height** (the
  button reserves its slot in-flow and only fades in; hover never resizes the row). **Expansion is a
  click, not a hover** (`plan-item-toggle` → `data-expanded`): the detail block is always mounted but
  CSS-hidden (`hidden` → `group-data-[expanded=true]:flex`), so a click persists it (and it works on
  touch, which has no hover) and the meta line yields to it (`group-data-[expanded=true]:hidden`);
  the chevron rotates the same way. No JS hover state — a static `<div>` with mouse/focus handlers is
  an a11y smell the lint rightly rejects. The detail block is an indented
  left-rail (`border-l`) block holding the note, the agent's `summary`, the full `VerificationBadge`,
  a changes_requested `feedback` note, the change set, **and — when the item accumulated 2+ commits
  (fix cycles) — a REVISIONS mini-timeline** (`plan-revisions`/`plan-revision`, off
  `planView.itemRevisions`): one row per commit in order (`#n` + sha chip routing the Changes panel +
  `DiffStatBadge` when the sha still resolves), the last marked *current*, and any sha in the
  review's `unreviewedShas` delta marked *unreviewed* (`data-unreviewed`) — the honest
  how-the-agent-got-here story (commit → review → fix → commit) no final-diff view can tell.
  Non-done items keep their note inline (no toggle — they rarely carry details). Inside the details, the change set stays its own **collapsible**
  disclosure — a summary line (sha chip + `N files` + `DiffStatBadge`) toggling the commit's
  `GitFileChange[]` rows; the chevron/summary is the
  toggle while the sha chip stays a separate button (routing the Changes panel, never toggling). Expanded,
  file rows open Monaco diff tabs at the item's `commit:{sha}` scope (`openDiffInTab`, preview intent; the
  path-list fallback opens at branch scope, no counts because they would drift), **and the review verdict
  ON the item row itself**: the row's right edge is ONE review slot rendering exactly one of, in
  precedence order, the clickable `Reviewing…` label (`plan-item-reviewing`, off the host-derived
  `review.reviewing`, opens the reviewer chat), the warning `Changes requested · N` chip, or the
  primary-filled `Start review` button (`plan-start-review` — the standard **small** action button:
  `h-6`/`tr-text-action`/`control-primary-bg`, the same size as `SendReviewButton`, not an oversized
  `min-h-8` block) for an unsettled reviewable item. The two **status**
  readouts stay always visible (state, not an action); the **`Start review` action reveals on the
  row's hover / keyboard focus**, exactly like the ProjectTree kebab: `[@media(hover:hover)]:opacity-0`
  + `[@media(hover:hover)]:group-hover:opacity-100` + `focus-visible:opacity-100` — so a wall of
  primary buttons never paints across every reviewable row on desktop, yet on a **touch** device (no
  hover) it stays visible, and it never sticks the way `group-focus-within` did. It is an **in-flow**
  button on the title line (the meta on line 2 frees that right edge, so the title simply shrinks for
  it — no overlap, no empty reserved slot). Still one slot, no duplicates — the change-set disclosure
  row carries NO review affordance.
  `Start review` fires the AGENT review (`todo.startReview` — the plan's reviewer chat) and STAYS on
  the plan page: the row's `Reviewing…` pulse and a toast are the only signals, success AND failure —
  the detached error notice lands in a reviewer chat nobody has open, so the toast must carry it.
  Row controls (`plan-item-toggle`, the change-set toggle, the sha chip, the review slot, `FileRow`)
  wear `min-h-8` — the dense metadata rows stay tappable on touch. `planView.changeSetCounts` is the
  one count/stat derivation (paths → count only; commit → `changeSetStat`), shared by the row's meta
  strip and the disclosure line. There is **no in-page manual verdict UI** — the former `manually` toggle
  + `ReviewActions` pair (Approve / Ask to fix) was removed with `PlanReview.tsx`; the `todo.review` /
  `todo.requestFix` wire methods and host handlers stay, so a manual-override surface can return without
  protocol work; agent-authored findings appear in the Review
  panel badged `agent` (`review-comment-agent`), and an agent-settled card reads `Reviewed · agent`;
  a **changes_requested** verdict marks the item loudly: the status glyph flips to the warning
  `CircleAlert` (`StatusIcon changesRequested`, `data-changes-requested` — popup row and plan page
  alike), the plan page's title row grows a warning **`Changes requested · N`** chip
  (`plan-item-changes-requested`; N = `planView.itemOpenFindings`, the reviewer's open comments
  matched by `origin` provenance (path-join fallback for provenance-less ones) — the Review tab is
  the truth; the chip
  `requestToolView`s the Review tab) and the verdict's `feedback` note renders inline
  (`plan-item-review-feedback`); approving settles the item — its status glyph upgrades to the **circled Verified check**
  (`StatusIcon reviewed`, hover "Verified", `data-reviewed` on the row; `planView.reviewSettled` is the
  one derivation — approved AND no unreviewed delta, so a fresh revision drops the item back out of both
  the glyph and the reviewed counter). **The header is a title + a lifecycle STEPPER and a kebab menu**. The stepper (`plan-progress`)
  renders the plan's shipping funnel — **Build (`d/t done`) → Review (`r/k reviewed`,
  `plan-review-progress`, only when the plan has reviewable items) → PR (`plan-pr-stage`,
  `data-state`)** — each stage wearing a glyph for its state: done (check), active (the stage the
  plan is currently at), pending (muted). The PR stage reads the same `useOpenBranchReview` lookup
  as the button and shows `PR #N` once one is open; "merged" is unknowable in V1 (the lookup only
  sees OPEN reviews), so the funnel honestly ends at PR-open. Under the stepper sits the **work
  CONTEXT line** (`plan-context`): `baseBranch ← branch · N commits · +A −R` — the arrow points at the
  merge TARGET (base ← head, the GitHub PR convention: changes flow from the workspace branch into
  its base). `N commits` is the **`PlanCommitsMenu`** (`plan-commits-trigger`) — a dropdown mirroring
  the Changes scope menu's commit list: `git.listCommits` (eager-loaded, reloaded whenever the plan's
  commit count ticks) is the ONE source for both the count and the list, so they never diverge — and,
  being the `base..HEAD` enumeration, it already spans the adopted commits (branch commits no step
  owns) alongside the per-step ones; each
  row (`plan-commits-item`, `data-sha`) opens that commit's diff in the Changes panel via the same
  `openChanges({ sha })` the per-step commit chip uses. The chip self-hides while loading and when the
  branch has no commits. The total diff comes from the workspace record's `diffStats`; each piece
  hides when unknown. Between header and summary lives the **NEXT-ACTION banner** (`plan-next-action`,
  `data-kind`) — the report's one "what now", rendering the FIRST matching state by urgency:
  `fix` (N steps carry changes_requested → **Show step** scrolls to the first flagged item and
  auto-expands it via the `focusRequest` token — `{ id, tick }`, tick bumped per click and consumed
  once per tick by the target `ItemBlock`, so a re-click re-expands a manually collapsed row and a
  stale request can't reopen it later) → `review`
  (N unsettled reviewables → an inline **Review All** button, same `todo.reviewAll` flow as the
  kebab item, which stays) → `ship` (all done + reviewed, no open PR → an inline **Open PR**,
  same `pr.open` flow as the header button) → hidden when nothing demands action. The plan-level
  completion note wears a `Summary` eyebrow so the report reads in labeled sections. After the item
sections the page renders **`Committed outside the plan`** (`plan-adopted-commits`, only when
`TodoPlan.adoptedCommits` is non-empty — including on an otherwise empty plan): the host-derived
`base..HEAD` commits no item owns (derivation: [[submodule-server-todos]]), each rendered with the same
**`ItemBlock`** as a planned step so it carries the identical change set, Start-review, and revisions
affordances — they are reviewable exactly like an item's commit. **Review stage only:** they are
*excluded* from the build `d/t done` count and never gate `ship`, but `planView.reviewableItems`
includes them so the Review stepper, the `review` next-action, and Review All cover them. Then the page
renders **`Outside the plan`** (`plan-unattributed`, only when
`TodoPlan.unattributed` is non-empty — including on an otherwise empty plan): the host-derived
uncommitted rows no item claims (derivation: [[submodule-server-todos]]), rendered as `FileRow`s
opening the **uncommitted-scope** diff — the honesty section that keeps un-planned work visible in
the review map instead of reading as "nothing else changed"; `chat/planMarkdown` exports it as its
own section. The kebab menu (`plan-menu`, a
  `DropdownMenu`) holding **Copy** (clipboard) / **Save .md** (browser download) — both compiling through
  `chat/planMarkdown` — and, when the plan has reviewable items, **Review All** (`plan-review-all`): fires
  `todo.reviewAll`, the host-side queue that agent-reviews every *unsettled* reviewable item one at a time
  (disabled when none are unsettled; a toast reports how many were queued, the per-row `Reviewing…` pulses
  track progress), plus **Open draft PR** (`plan-open-draft-pr`, hidden once a PR exists). **The header
  also owns the plan's finish line — Open PR** (`plan-open-pr`, task-open-pr): a deterministic
  host-side flow (push + `gh`, NEVER an agent prompt) that, **for first-time creation only**
  (`openReview` absent), goes through the **compose dialog** (`PrComposeDialog.tsx`,
  `pr-compose-dialog`): the click fetches `pr.preview` and opens editable
  Title (`pr-compose-title`) + Description (`pr-compose-body`, prefilled from the plan) fields;
  only the submit (`pr-compose-submit`, label follows the action — Open PR / Open draft PR) runs
  `pr.open` with the edited `title`/`body`. The dialog closes on success, stays open
  on a generic failure (edits survive the toast), and hands off to `PrSetupDialog` on
  `PUSH_AUTH_FAILED` — whose Try again re-submits the LAST edited title/body (kept in a ref), never
  a re-rendered draft. The header button is primary-filled when the plan is
  *ready* (all done + all reviews settled) and quiet otherwise; once an open PR exists (the same
  `workspace.openReview` lookup the shell's scope label uses, via `useOpenBranchReview` — the hook
  lives in `panels` because nothing may import `shell`) the label flips to **Push updates**
  and the button **bypasses the compose dialog entirely** — pressing it (or the next-action `push`
  arm) calls `pr.open` directly with no `title`/`body`, so the host pushes to the SAME branch/PR and
  silently refreshes its body from the plan (`renderPrBody`) while leaving the PR title untouched
  (no `titleEdited`). Re-editing a PR's description each push read as "set up the PR again"; the modal
  is only the creation affordance. When the lookup reports
  **`unpushedCommits`** the label appends the count (`Push updates (N)`), the button turns
  primary-filled, and the next-action banner grows a `push` arm ("N new commits aren't in PR #N
  yet" + Push updates) so new work after the PR never sits silently local — a successful push
  re-reads the authoritative state and clears both when the remote-tracking branch caught up. Also a **`PR #N` chip**
  (`plan-pr-chip`) links out when the URL is known — which is now every read, since `workspace.openReview`
  carries the review's own `url` ([[submodule-server-branch-review]]); the keyed state prefers it and falls
  back to a url carried over from an earlier answer for the same review, so a chip never loses its link on
  a refresh that reports none. The hook owns the ONE keyed PR state:
  `noteOpenReview(review, url?)` seeds it right after `pr.open` (no separate shadow state in the
  page) and supersedes any read already in flight for the same key, so a pre-mutation answer cannot
  overwrite the mutation result. The keyed state and request generation are shared by every mounted
  hook consumer, keeping the plan and shell scope label on one mutation result. A stale mutation closure
  cannot write through after that hook has moved to another branch. The focus-refetch overwrites state.
  Workspace activation explicitly opts into the host's 60-second settled-answer cache with
  `allowCached: true`, while omission on focus preserves the wire's original force-fresh behavior for
  older clients, so a PR closed/merged on GitHub drops out of the chip, label, and stepper on that
  refetch instead of sticking until remount. Focus received while disconnected latches that fresh
  intent and spends it on reconnect rather than falling back to a cache-eligible activation read. The
  URL is kept across refetches while the review number matches. A `compare` result opens the prefilled
  GitHub
  compare page (`window.open`); every outcome toasts, uncommitted files get a separate info toast.
  The `pr.open` request runs with a **180s timeout** (push + gh mutation can outlast the transport's
  60s default) and the header button wears a spinner while any PR work is in flight — the
  **Pushing…** label only during the actual submit (a preview fetch is not a push, and its failure
  toasts "Couldn't prepare the PR", never "Open PR failed"). The uncommitted-files info toast fires
  once, before the outcome branches. Every successful submit starts a fresh shared open-review read
  after seeding any review returned by `pr.open`. It never treats the mutation payload as the final
  unpushed count: the post-push read decides whether the count cleared or newer local commits already
  made it nonzero again. The compose submit also reports whether the title was touched
  (`titleEdited`) so the host never rewrites a GitHub-side rename with the regenerated prefill.
  **Failures that name a fixable setup gap open `PrSetupDialog` (`PrSetupDialog.tsx`,
  `pr-setup-dialog`) instead of a toast**: a `PUSH_AUTH_FAILED` rejection (matched via the
  transport's `wsErrorCode`) explains that the host pushes without a terminal and shows git's
  stderr (`pr-setup-detail`) plus copyable fixes (`ssh-add --apple-use-keychain …` for SSH,
  `gh auth login` for HTTPS); a `compare` result carrying `ghProblem` explains the missing/
  unauthenticated GitHub CLI with install/sign-in commands and offers the compare page as an
  in-dialog link (`pr-setup-compare` — a real anchor, so no popup-blocker risk) instead of the
  blind `window.open`. Both variants keep a **Try again** (`pr-setup-retry`) that re-runs the same
  flow — always with the LAST edited title/body (the `lastPrSubmit` ref, set on every submit,
  cleared only when the flow fully succeeded, when the user explicitly cancels the compose dialog,
  or when they take the compare-page hand-off (external completion the client can't observe) — a
  `ghProblem` outcome otherwise keeps it, so the gh dialog's Try again actually re-submits;
  reopening Open PR after a failure reuses those edits (including the edited-title baseline, so a
  reopened draft doesn't lose its `titleEdited` flag) instead of refetching a regenerated draft); command rows copy via
  `copyText` (`pr-setup-copy`) and carry a **Run** (`pr-setup-run`) that closes the dialog and
  executes the command in a fresh workspace terminal via the store's
  `addTerminal(workspaceId, initialCommand)` — the pty is a real interactive shell, so
  passphrase/login prompts are answered right there instead of asking the user to find an external
  terminal. Command sets are **host-platform-aware** (the welcome's `hostPlatform`, validated on
  intake and RESET on every welcome so switching hosts can't leave a stale platform; there is **no
  darwin fallback** — a null/unknown platform gets the generic commands: plain `ssh-add`, no
  package-manager guess, a cli.github.com install hint): `ssh-add --apple-use-keychain` / `brew` on
  macOS, plain `ssh-add` + the distro hint on Linux, `$env:USERPROFILE` + winget on Windows — the
  commands run on the HOST, so the browser's own platform is never consulted. A push-auth detail
  matching `Host key verification failed` adds an approve-the-host-key row (`ssh -T git@github.com`
  run interactively) — the ssh-add/gh remedies don't fix known_hosts. A `compare`
  *without* `ghProblem` (offline seam, transient gh failure) keeps the window.open + toast path.
  This dialog is unit/e2e-pinned on the server side (`isPushAuthFailure`, `ghSetupProblem`); the
  browser-side arms need a real broken push / missing gh, so they stay convention-held.
  The agent's plan-level completion note (`plan-overall-summary`) renders **clamped to
  3 lines** with a `Show more`/`Show less` toggle (`plan-overall-summary-toggle`, shown only for long
  notes) — the page opens on the plan, not on a wall of prose. There is **no in-page "Review mode"** — findings live in the right-panel **Review** tab;
  when the reviewer agent has open comments (`selectAgentReviewCommentCount` — open, `author: "agent"`) the
  header shows a **`N comments`** chip (`plan-review-comments`) that `requestToolView(ws, "review")` to
  focus that tab. The header also shows the agent's plan-level completion note
  (`planCompletionSummary`-gated `plan-overall-summary`). `FileRow` (`planFileRow.tsx`, its own module so plan surfaces
  share one row without cycles) is the shared change-set row. Live by
  construction, it reads through the same `useChatTodos` hook as the plan popup (per-mount fetch +
  `pi.event` refetch), so it cannot show a stale snapshot.
  `TerminalWorkbench` owns one visibility-gated terminal body per semantic terminal identity and
  the host-atomic close flow. A busy close remains one correlated request through confirmation and forced
  retry; dialog auto-close cannot release that request, authoritative catalog removal dismisses stale
  confirmation, and a rejected force clears exactly that request with an error so a later close can start
  cleanly. The workbench close command for a chat routes to `store.closeChatToHistory` (keeps the session
  alive) and shows a
  **chat-history** dropdown (recently-closed + disk-only chats, shown only when non-empty); each row has
  a one-click trash action (`session.delete` → idempotent `store.deleteChat`, no confirm); the
  `session.deleted` broadcast drives the same fold in every connected client. On workspace activation and
  every reconnect, `session.list` first reconciles the client membership snapshot (runtime/cache identities
  plus placed chat/TODO-document references) captured when the read began, so a baseline session now absent
  from the authoritative result goes through the normal tombstone and local-placement prune while a chat
  created during the read survives. Chats referenced by this surface's local workspace view hydrate through
  `session.getMessages` → `messagesToRuntime` → `store.hydrateSession`. Every remaining session enters local
  history without opening or selecting a tab: another frontend creating or using a chat is domain activity,
  not a placement instruction. A failed transcript read raises an error toast and leaves that summary
  retryable in history; a failed `session.list` also raises an error instead of presenting an unexplained
  empty workspace. Both toasts fall silent once reconciliation is cancelled, disconnected, or archived.
  Live hydration deliberately carries no current-disk skill baseline; only disk-only attachment receives its
  captured `syncedTick`. `session.deleted` drives the same idempotent runtime/history/local-placement fold in
  every client; no current-layout push exists. Reopening a
  history row adds its existing session identity to the request-time center destination captured from that
  Group Header (including an empty group); a rejected read leaves the row in history and raises an error
  toast. The workbench shell integration also resolves the history-search **`chatLocationRequest`** deep link
  (see `store/SPEC.md`):
  once its workspace is active, it focuses an already-open tab, `reopenChat`s a live-but-closed one, or
  fetches + hydrates a disk-only one — the reopen flow's two cases above, plus a third case for an
  already-open tab — leaving `ChatView` to consume the request for the scroll + flash (`chat/SPEC.md`'s
  Jump-to-message bullet). **`Toaster`** is the app-wide toast host the shell mounts once: it subscribes to `store.toasts` and
  renders each via the `components/ui/toast` primitives, letting Radix own the auto-timeout + swipe/hover-pause
  and routing every close back through `store.dismissToast` (so the store stays the single source of truth).
  Errors persist until dismissed; success/info time out. The **integration piece** — the primitives stay
  presentational.
- **Public surface:** layout-agnostic feature renderers (`ProjectTree`, `WelcomePanel`, file/diff/doc/chat
  panes, singleton side tools, terminal bodies, Settings, and `Toaster`), imported **per-file** so
  Monaco/shiki/xterm stay lazy. Tab strips, group headers, side stacks, and center topology are not panel
  surfaces; the shell layout module wraps these renderers.
- **Allowed deps:** `store`, `transport`, `components` (`SkeletonRows` — every async panel's pending
  state renders content-shaped skeleton rows, never a bare "Loading…" line), `@thinkrail/plugin-ui`
  (the eleven primitives incl. `popover`/`command`/`textarea` for the dialog; `Outline`/`ToggleSegment`;
  `MonacoEditor`'s pure display-setting props are supplied here from the store — see `panels/MonacoEditor.tsx`),
  `@thinkrail/plugin-ui/markdown` (`Markdown`, reused by `MarkdownPreview`), `@thinkrail/plugin-ui/editor`
  (`MonacoDiff`'s theme/review/menu-icon helpers), `chat` (`ModelSelector`/`ThinkingSelector` + the
  `useModelCatalog` hook that feeds them, reused by `NewWorkspaceDialog`; `TemplateEditorDialog`, reused
  by `TemplatesSettings`), `lib`, `themes` (catalog + generic application contract),
  `contracts`; `@remixicon/react`; `plugins/registry` (the file-open dispatcher, `Companions`,
  `PluginToolBody`, terminal accessories, and the plugin agent launchers all read it); `@thinkrail/plugin-api`
  (`/web` types — `FileViewerProps`, `CompanionHost`, `TerminalAccessoryApi`, `AgentLauncher`, `EditorEvent`;
  and the root `parsePluginToolId`, used by `shell/railDefault.ts`, not by any panel); and the heavy libs
  each lazy panel owns (`monaco-editor`, `@xterm/*`, `pdfjs-dist`) loaded via `import()`.
- **Forbidden:** `server`/`shared`/`pi`; importing `shell`; reaching across unrelated panels.

## File rows own their context menu

A row git ignores (`FileNode.gitignored`, decided by the host with `git check-ignore`) is dimmed by the
shared `TreeRow` (`data-muted`, `text-text-subtle` on the label) and titled "Ignored by git" — still
openable, still a real file, just visibly not the repository's. Pinned by `files.spec.ts`.

**A Files-tree row is a drag source, and a terminal and the composer are where it lands.** Every row
(`TreeRow` with `onDragStart`, native HTML5 drag — not the workbench's dnd-kit, which is for tabs)
carries the entry it represents (a compacted chain drags as its deepest folder) as `lib.fileDrag`'s
`application/x-thinkrail-file` payload plus the path as `text/plain`, so any plain text field takes the
path too. Dropped on a terminal (`TerminalInstance` listens on its xterm host, natively — a drop has
no keyboard path, the line itself is the accessible way in) it is handed to whatever runs there: an
`@`-mention through the same `attach` an editor selection uses when Claude Code is running, otherwise
the absolute path as one shell word (`shellQuotePath`), like Finder would drop it. Dropped on the chat
composer it becomes an `@path` mention at the caret (`@dir/` for a folder), the same text `@`
completion inserts. Pinned by `files.spec.ts`.

A right-click on an All-files row opens `file-node-actions` (Reveal in Finder, Copy path, Delete). The menu
exists mostly so the *webview's* does not: with no handler, WebKit shows its own Look Up / Translate /
Share / **Show in Finder** menu, whose reveal item is about downloaded files and does nothing for a
workspace path — it reads as a broken feature rather than an absent one.

- **Reveal selects the file, it does not open it.** `fs.revealPath` resolves through the same worktree
  gate as every other read (so a path cannot walk out of the workspace it names) and calls
  `editors.revealPathInFileManager`, which uses `open -R` on macOS and `explorer /select,` on Windows.
  The pre-existing `revealInFileManager` stays as-is for *workspace* reveal, where opening the folder is
  the right verb. Linux has no portable "select this entry", so it opens the containing folder.
- The label follows the platform's own name for its file manager; "Show in Finder" on Linux would read
  as a bug.
- **Delete moves to the trash, after a confirmation.** `Delete file` / `Delete folder` opens the shared
  destructive `ConfirmDialog` naming the row, then calls `fs.trashPath`, which the host resolves through
  the same worktree gate as reveal and hands to the agent module's `trashFile` — the one OS-trash move
  already used for chat transcripts — so a mis-click is recoverable from the Trash rather than gone.
  The workspace folder itself is refused by name. A compact folder chain deletes from its top segment,
  which is what the row shows. The tree does not remove the row itself: the worktree watcher's
  `fsChanged` push re-reads the listing, the same path every external delete already takes, and a
  failure is a toast.

## Tab labels carry our tooltip, not the browser's

A center/side tab name is truncated far more often than not, so the full name has to be reachable on
hover. It uses the shared `IconTooltip` rather than a native `title`: the native one is unstyled and
waits about a second, which is useless for text the user is already looking at.

- **It keeps the provider's delay, deliberately.** `delayDuration={0}` was tried first and is the
  obvious reading of "instant" — it is not shipped, because it reliably wedges the tab-search popover
  open: with an instant tooltip on every tab, widening the window past the overflow threshold leaves
  `Find an open tab…` mounted over a strip that no longer overflows (`e2e/layout.spec.ts`'s keyboard and
  menu commands test fails ~2 runs in 3, against a ~1 in 3 baseline for that file). The provider's
  `skipDelayDuration` already makes every tooltip after the first instant while moving along a strip,
  which is the case that actually matters.
- **The tooltip wraps the tab *button*, not the label span.** Anchoring it to the name reads better on
  paper — the label *is* the truncated name — but Radix's trigger then sits on the element a tab drag
  starts from, and swallows the pointer events the drag needs: `e2e/layout.spec.ts`'s side-group
  resize test fails 4 runs in 4 that way. The button is already the drag handle and the accessible
  control, so the trigger belongs there.
- `IconTooltip` grew an optional `delayDuration` for this, and it stays available — but nothing in the
  tab strip may use `0` without re-checking the two tests above.
- **A tooltip is a label, never a target.** `TooltipContent` is `pointer-events-none` app-wide: anchored
  beside a control it inevitably covers a neighbour, and a panel that swallows the click meant for the
  tab underneath is worse than no tooltip at all. Safe because every label in the app is plain text —
  an interactive tooltip would need its own component, not this one. The tab tooltip additionally opens
  **along the strip's own axis** (`right` when vertical, `bottom` when horizontal) so it lands beside the
  strip rather than on the next tab, and is anchored to the **whole tab row**, not the name button: the
  button's right edge is exactly where the close cross sits, so a vertical strip's tooltip opened there
  hides the control the same hover just revealed. Anchoring the row also keeps Radix's trigger off the
  drag handle, which is what broke dragging when it wrapped the label span. `e2e/layout.spec.ts` pins both the computed `pointer-events` and
  that a covered neighbour is still clickable.

## Selecting in the rendered document reaches whichever plugin is listening

A selection made in the markdown preview is reported the same way an editor selection is
(`transport.reportIdeSelection`) — a generic emitter now (`transport/editorReports.ts`), with
`@thinkrail/plugin-claude-code`'s own `ctx.editors.onEvent` listener the one production consumer today, so
highlighting a passage of prose is still a way to hand it to a running Claude Code session. A plugin's own
rendered document reaches the same bridge through
`ctx.editors.reportSelection` (`plugin-api/SPEC.md`, W12) rather than importing `transport` directly —
the Blueprint plugin's pane is the one caller today, stamping its own blocks with the same
`data-md-line-*` attributes from `BlueprintState.lines` (a block-id → span map the host derives from the
*serializer*) so `stampedSelectionLines` reads it without knowing the difference from ordinary markdown.

- **The range is block-level; the text is exact.** The line span comes from the `data-md-line-*` stamps
  the review comments already rely on, which mark enclosing blocks — so selecting half a paragraph
  reports that paragraph's lines with the selected text. That is the honest limit of what the rendered
  view knows, and it is why the transport's de-dupe keys on the text as well as the range: two
  selections inside one paragraph share a range and must still both be reported.
- **Paths are absolutized by the plugin, not this module.** The client addresses files worktree-relative;
  Claude Code expects a path it can open, so `@thinkrail/plugin-claude-code`'s own `selectionChanged`/
  `documentClosed` handlers join the workspace's worktree path host-side, the same shape the old
  `ideBridge.selectionChanged`/`documentClosed` always had. An `external-file` path is already absolute and
  passes through.

## Claude Code's IDE actions

Moved wholesale to `@thinkrail/plugin-claude-code/web/ideActions.ts` — what a `claude` CLI
asks of the editor (open a file, list open editors, close a tab) is now answered through
`PluginWebContext`'s generic `editors` capability (W12) rather than a `transport`-level registration seam
(`setIdeActionHandler`, `ideBridgeActions.ts`, both gone). Most of the old behavior carried over exactly —
every action still replies including a failed one, `openDiff` still says `diffShown: false` rather than
claiming a diff appeared, `saveDocument`/`checkDocumentDirty` still answer from the editor's real buffer
state — see `module-plugin-claude-code`'s SPEC.md for the two things that did not carry over unchanged:
path-relativization is now a plugin-local approximation (no case-insensitive/Windows handling), and
`closeTab` now matches by path basename rather than an exact `EditorRef` field, since the generic
`editors.list()` this plugin reads carries no tab name.

What stayed here, generic and unrelated to which plugin (if any) is listening:
- **Change rows wear the changed-file mark in both views** — the tree view gets it from `TreeRow`, and the
  list view draws it beside the path. A changed file is still a file, and a column of them is exactly
  where the eye is scanning for one.
- **File rows and the attach picker wear the file's own icon** (`components/FileTypeIcon`, via `TreeRow`'s
  `iconPath`), so a tree reads as its types rather than as a column of identical glyphs. Folders keep the
  Remix folder pair, which still has to say open/closed and selected/not — a state a type icon cannot
  carry.
- **`MonacoEditor` reports its selection** (`onDidChangeCursorSelection` → `transport.reportIdeSelection`)
  and reports the document closed on unmount, which is also what makes `getLatestSelection` outlive the
  tab. It reports only when given a `workspaceId`, so a Monaco instance rendered outside a workspace tab
  contributes nothing. Paths arrive absolute and are made worktree-relative through the same
  `projectRelativePath` every other open goes through, so an IDE-driven open and a user-driven one produce
  the identical tab identity instead of a duplicate addressed the other way.

## Sending a selection to a pi chat

That live selection reporting only ever reached **Claude Code**, over the IDE bridge — a pi chat had no
way to be told what the user is looking at, and pasting was the workaround. The editor now reports what is
highlighted to the **store** as well (`setEditorSelection`, cleared when the selection empties or the tab
unmounts), which is what the chat composer shows as a chip and sends with the next message — see
`chat/SPEC.md`. An attachment nobody can see is an attachment nobody trusts. The **rendered markdown
preview reports to the same store** from the same listener that feeds the IDE bridge, with the block-level
line span the stamps give it and `markdown` as the language. It does not clear on a collapsed DOM
selection: clicking into the composer collapses the document selection, and the chip would vanish exactly
as the user reached for it. It clears on unmount only when the held selection is its own file, so
toggling to source or closing the tab drops it without touching another tab's highlight.

**"Send selection to chat"** (`sendSelectionToChat.ts`) is the other half: it quotes the selection into the
workspace's chat composer as text, for pinning several snippets into one message, and takes the chip off
for that selection so the same lines are not sent twice. The quote itself is `lib/editorSelection.ts`, so
the two paths cannot drift into two formats.

- **The quote is `path:lines` above a fenced block** of the selected text, tagged with the editor's own
  language id (`lib`'s `selectionQuote`, shared with the composer's chip). The path is the worktree-relative one the user reads in the file tree, and a single-line
  selection says `README.md:1`, not `1-1`. A trailing line the user did not really select — a selection
  that ends in column 1 of the next line — is trimmed off the range, matching the review composer.
- **The text travels, not a pointer to it.** The agent can read the file itself; what it cannot recover
  is which part of it the question is about.
- **It targets the workspace's chat and creates one if there is none** (`selectLastOpenChatSession`, else
  `createSessionWithSkillBaseline` + `openChatSession`) — the same escalation `reviewSend.ts` uses, since
  both are "put this into a chat" from outside the chat.
- **The composer keeps the caret.** The open passes `focusTab: false` and the draft write asks for the
  composer (`store.addToChatDraft` → `composerFocusRequest`), because the app's ordinary open focuses the
  tab button, and landing there would mean the next keystroke goes nowhere.
- **Two ways in: the editor context menu and Ctrl/Cmd+Shift+L.** The chord is handled in the editor's own
  `onKeyDown` beside Ctrl/Cmd+S rather than as an `addAction` keybinding — Monaco's built-in binding for
  that chord (select all occurrences) wins the keybinding service, and this deliberately shadows it.

## Editing a file

An editor tab is a buffer, not a viewer. There is **no autosave**: Ctrl/Cmd+S writes, and until then
nothing on disk moves — the tab shows an unsaved dot and closing it asks first.

- **A save is a compare-and-swap** (`fileSave.ts`, `fs.writeFile` for a worktree path,
  `@thinkrail/plugin-claude-code`'s `readFile`/`writeFile` for an external one — reached by
  `pluginMethodName`, since a core panel calls a specific plugin's method by name here rather than through
  a generic capability; `plugins/claude-code/SPEC.md` names this a known gap) against the
  content the editor last read. A file that moved underneath is never overwritten: what is on disk comes
  back and is merged into the buffer with `lib`'s three-way merge, leaving conflict markers where both
  sides changed the same lines. Saving again is then an ordinary write against the newer base. The user
  therefore always sees what is about to be written, including in the clean-merge case — the merge lands
  in the buffer rather than being written for them.
- **A file changing under an unsaved buffer is announced immediately**, not held until the save fails:
  the refresh that would normally replace the tab's content parks it in `external` instead and the pane
  shows a bar offering the same merge, or discarding the buffer for what is on disk. Its buttons
  `preventDefault` on mousedown, so the caret stays in the editor and Ctrl+S still reaches it.
- **The pane owns the shortcut, not the window.** Monaco handles Ctrl+S when the caret is in it, and the
  pane handles it for everything else in the pane; a window-level listener would fire for a focused
  terminal, where Ctrl+S means something else entirely.
- **The wrapper around the editor is unconditional.** A bar appearing must not change the shape of the
  tree around Monaco, or React remounts it and the caret, scroll position and undo history go with it.
- **External files are editable too**, through the allowlist `@thinkrail/plugin-claude-code`'s configuration
  pane already resolves — the same compare-and-swap, the same merge.

## What a Claude terminal is running on

Moved wholesale to `@thinkrail/plugin-claude-code`'s `web/ClaudeTerminalFacts.tsx` — the model
chip, the effort chip, the TodoWrite plan toggle, and the file-attach chip all live there now, rendered
through the generic `ctx.terminalAccessory` slot (`shell/SPEC.md`) rather than a Claude-specific block
inside `TerminalInstance.tsx`. The agent-status protocol, the "last reported answer stands" merge, the
model/effort picker-driving mechanics (arrow the `❯` highlight, press `s` for session-only), and the
sealed-pane-during-a-drive behavior all carried over — ported, not redesigned; see that plugin's own
SPEC.md for what changed in the move:
- The picker-driving seal no longer works by gating `TerminalInstance`'s own `onData` (a plugin cannot
  reach it) — the overlay now grabs DOM focus itself and reclaims it on blur, sealing input without any
  new `plugin-api`/`TerminalAccessoryApi` capability.
- The attach chip lost its in-app worktree browser (`fs.readDir`, filter, up, per-entry rows) — no
  `PluginWebContext` capability serves a live directory listing today, so it is one button calling
  `ctx.pickFile()` (the host's native picker) instead.
- `TerminalInstance.tsx` itself keeps only one residual, functional (not cosmetic) Claude-specific line:
  `agentNewline`, which decides whether xterm's extended-key encoder treats Enter as `\r` or `\n` for a
  `record.kind === "claude"` terminal — an accepted coupling with no generic replacement built for it.

## The Claude configuration pane

Moved wholesale to `@thinkrail/plugin-claude-code`'s `web/` — the four-surface pane (Context,
Settings, Capabilities, Account), its refresh/usage-cache mechanics, the `@`-import branch tree, capability
rows and their ⋮ menus, plugin uninstall, and the two-dialog compose-then-approve edit flow all carried
over onto the plugin's own `PluginWebContext`, largely unchanged in shape. See that plugin's own SPEC.md
for the differences the move itself forced: `QuietScrollArea` (a core-only component a plugin cannot
import) is a plain scrollable `div` there instead; the `fsChangesByWorkspace`-driven auto-refresh tick was
dropped in favor of manual refresh plus a mount-once load, since a plugin's web half has no reach into that
core store slice; and the settings pane's on/off switch is gone from the pane itself — it is Settings ›
Plugins' generic toggle now, the same one every plugin uses.

The rest of this section is core panels' own generic file-focus infrastructure, illustrated above by a
plugin's row-click-opens-a-file behavior (`SourceButton`, now `@thinkrail/plugin-claude-code`'s own
component) but not owned by any plugin — a link lands on the entry, not the top of the file, because
`~/.claude.json` holds every project's MCP servers at once and a settings file holds dozens of keys, so
opening at line 1 leaves the reader hunting for the row they just clicked.

- **A key path names a value; the line is computed here.** A `{ workspaceId, path, keyPath }` focus
  request names the value as JSON object keys (`["mcpServers", "git"]`), and `FilePane` turns it into a
  line with `jsonKeyLine` against `tab.content` — the text the editor is about to show. A line resolved by
  whoever requested the focus would be measured against the file as it stood when they last read it, and
  would be wrong for every row below an edit made since. Resolving here also costs one lookup per click
  instead of a scan per resolved key, and adds no round trip. **Currently unproduced**: the Claude
  configuration pane was the one caller (`ClaudeConfigOrigin.keyPath`), and `PluginWebContext`'s
  `editors.open()` has no `keyPath` option, so nothing calls `requestFileFocus` with one today — the
  mechanism works the moment something does; see `store/SPEC.md`.
- **A markdown file has no editor to land in, so the block lands instead.** Markdown opens rendered, and
  the request carries a source line — a line nothing on screen is numbered by. The preview resolves it
  through the same `data-md-line-*` stamps the review path already puts on every block, scrolls the block
  that line fell in into view, and flashes it. The flash fades on purpose: a mark that stayed would be
  read as a selection, the mistake `.review-region` is shaped around. In split and source view the request
  is left to the editor, which can put a caret on the exact line. The narrowest block wins when several
  contain the line, so landing inside a table cell marks the cell, not the table.
- **The request is ephemeral, not part of the tab.** `store.fileFocusRequest` carries
  `{ workspaceId, path, keyPath }` — or `{ workspaceId, path, line }` when the caller already knows the
  line, which is what a search hit hands over (`requestFileLineFocus`); the resolver runs only for the key
  path — and the editor clears it once it has revealed the line — the same
  request/consume/clear shape as `reviewFocusRequest`. It deliberately does *not* ride on the tab or the
  layout document: those hold durable source identity, an already-open tab is reused rather than rebuilt
  (so a line baked in at build time would be ignored on the second click), and a caret position is not
  something a restored layout should re-assert.
- **`SearchOverlay` is a popup, not a panel.** `Mod+Shift+F` (shell/SPEC.md) opens one query box over the
  active worktree; the host answers with `fs.search` (fs/SPEC.md: a bounded substring sweep, 200 hits max),
  and the overlay groups the hits by file, one row per line, each opening that file at that line. It is a
  dialog rather than a tool tab deliberately: a search is a question you ask and dismiss, and giving it a
  rail slot would cost a panel that stays whether or not you are searching. The query is debounced and each
  request carries a generation, so a slow answer for an abandoned query never overwrites a newer one.
  Ceilings, all deliberate for a first version: no regex, no case toggle, no glob filter, no replace.
- **A key path that does not resolve opens the file at the top.** `jsonKeyLine.ts` — a scanner, because
  `JSON.parse` discards exactly the positions this needs — returns `null` for
  anything it cannot walk exactly, so a malformed or restructured file degrades to the old behaviour
  rather than pointing at a wrong line. It stays in `panels/` rather than `lib/`: the pane that produces
  a key path and the editor that consumes one are both here, and `lib/` is for what more than one module
  needs. Rows whose origin *is* the file — context layers, skills, agents,
  problems — carry no key path and open at the top by design.
- `MonacoEditor` reveals from both `onMount` and an effect: a link-opened tab already holds its line by
  the time the lazy loader resolves, which is after the effect first ran.

## Plugin surfaces

- **The file-open dispatcher (`openTabs.ts`'s `openFileInTab`).** Before deciding kind/binary-ness itself,
  it asks `selectFileViewer(path)` (registration order, first eligible wins — `plugins/SPEC.md`). A
  registration whose own `open(workspaceId, path)` returns `true` has fully handled the open — the
  function returns without ever building a tab or reading anything, the same short-circuit a plugin would
  use to hand the path to an external app. Otherwise `viewer.read === "none"` is this dispatcher's only
  notion of "binary": what used to be two hardcoded `isPdfPath`/`isImagePath` checks is now core's own
  image viewer (`coreViewers.ts`) and the `pdf-preview` plugin's viewer sitting in the same table,
  registered under the synthetic `"core"` plugin id (image) or the plugin's own id (pdf) at module load
  (core imported once, for that side effect, from `main.tsx`). A landed open — one that was not
  superseded by a faster or later request — fires an `"opened"` editor event (`editorEvents.ts`) once
  the tab is actually in the store; a superseded one fires nothing, because nothing landed.
- **`FilePane`'s viewer arm** is the render-side half of the same table: `selectFileViewer(tab.path)` in
  place of the old `pdf`/`image` locals, and `viewer.component` (a `FileViewerProps` component, keyed by
  the winning registration's plugin id) renders before the markdown/Monaco fallthrough whenever
  `viewer.read === "none"`. `coreViewers.ts`'s image component is a thin adapter from
  `FileViewerProps.revision` to `ImagePreview`'s existing `cacheBust` prop — that panel is unchanged; the
  pdf-preview plugin's own viewer is `packages/plugin-pdf-preview/SPEC.md`'s concern.
- **`PluginToolBody`** is what a plugin side-tool tab actually renders, once the shell has resolved the
  tab id against its tool catalog: given a label/icon/`dormant` flag (from that catalog, not repeated here)
  plus the tool id, it looks up the *mounted* registration (`selectSideTool`) and renders that component in
  an `ErrorBoundary`, or a "*label* is off" placeholder naming Settings › Plugins when dormant or
  unmounted. It takes flat props rather than a shell catalog type so it stays inside this module's
  dependency boundary (no `shell` import) — `shell/SPEC.md` owns how the catalog itself is built.
- **`Companions`** replaces the old terminal-only `useTerminalCompanion` hook and `ChatHost`'s inline
  blueprint special case with one generic component: `<Companions host={{kind, workspaceId, key}}>` mounts
  a `CompanionProbe` per `selectCompanions(host.kind)` registration (each its own component instance, so a
  roster change never varies how many hooks *one* component calls), aggregates their `useAvailable(host)`
  answers, and renders whichever is both available and not hidden — the entry last passed to
  `focusEmbeddedPane` leads, other available ones fold into chips (`terminal-embedded-chip` /
  `chat-embedded-chip`, preserved from before generalization). `@thinkrail/plugin-visualize`'s web half
  registers the visualization companion (`hosts: ["terminal"]` only — a chat already renders the
  `visualize` call in its own transcript); `@thinkrail/plugin-blueprint`'s web half registers its own
  companion (`hosts: ["terminal", "chat"]`) the same way, each from its own module. The plugin's own
  `blueprintAuthors` / visualize's per-tab lookup is what makes "which host does a companion belong to"
  logic unit-testable without mounting anything (`plugin-blueprint/SPEC.md`, `plugin-visualize/SPEC.md`).
  A companion's tab title is normally its static `CompanionRegistration.title`, but a registration may
  supply `useTitle(host)` to override it per instance — the visualize plugin uses this for a drawing's
  own heading, since its pane has always had a per-instance name rather than the plugin's static one.
  Recorded availability (and per-instance title) is pruned to the roster's current kinds on every
  registration change, so a plugin that unmounts mid-session cannot leave a stale entry behind and keep
  its companion showing.
- **Terminal accessories.** `TerminalWorkbenchBody` renders `selectTerminalAccessories()` in one flow row
  (`terminal-accessories`) under the terminal body — the panel is a flex column, the body a `flex-1`
  frame — so an accessory takes its space from the body rather than floating over the shell's prompt; a
  whole-panel overlay an accessory renders (the picker seal) still positions against the panel, which
  stays the positioned ancestor, and a popover an accessory opens anchors to its own `relative` chip.
  Each accessory is keyed by plugin id and given a `TerminalAccessoryApi` built from a
  `TerminalInstanceHandle` — the imperative ref `TerminalInstance` (now `forwardRef`) exposes via
  `useImperativeHandle`: `write` sends through the same `terminal.write` request path as a keystroke,
  `bufferTail` reuses the picker's own tail-reader (parametrized by line count), and `setKeyEncoding`
  toggles a ref the key handler reads on every keystroke (`"agent-newline"` sends the newline byte the
  `claude-code` plugin's own accessory needs, `"default"` otherwise) — this used to be a store lookup
  hardcoded to `agent?.kind === "claude"` inside `TerminalInstance` itself; the decision is now the
  plugin's, driven from `ClaudeTerminalFacts`.
- **Agent launchers.** `NewWorkspaceDialog`'s agent row is "Bundled agent" (pi) plus every
  `useLaunchers()` registration — each rendered through its own `LauncherAgentOption` so
  `launcher.useAvailable()` is that component's own single hook call. A selected launcher's
  `terminalCommand()` opens a terminal exactly where the old hardcoded `claude` branch did; the Claude
  Code plugin's own `ctx.launcher()` registration is what exercises this path now.
- **Editor events** (`editorEvents.ts`): a plain `Set`-based emitter (`emitEditorEvent`/`onEditorEvent`),
  plus `findEditorRef(workspaceId, path)` — the one place that turns those two into an `EditorRef` by
  looking up the live tab, shared by every emitter that only has a path (`openTabs`, `fileSave`,
  `MonacoEditor`, `MarkdownPreview`) rather than four copies of the same lookup. `MonacoEditor` and
  `MarkdownPreview` emit `"selection"` exactly where they already report to the IDE bridge
  (`reportIdeSelection`); `fileSave` emits `"saved"` once a write actually lands; `openTabs` emits
  `"opened"` as described above. Nothing emits `"closed"`/`"activated"` yet — those are tab-lifecycle
  events the shell's own tab-close/-focus paths will need to raise, not a panel concern.

## Get right

- **Workbench tab chrome is not a feature panel.** The shell layout module supplies one selected-tab
  grammar to every group: `control-bg-selected` behind the whole selectable tab, `text-default`, and a
  **2px `primary` marker spanning the tab's full width** on the bottom edge (`after:inset-x-0`, flush
  with the selected fill — no horizontal inset). Inactive tabs stay transparent with muted text; hover
  uses `control-bg-hovered`; keyboard focus keeps its separate focus ring. The marker is a shape cue, not
  merely a text-colour change, so selection remains obvious when a high-contrast theme makes neighbouring
  surfaces equal. The grammar also supplies bounded one-row overflow and the complete WAI-ARIA tabs
  pattern with roving focus and labelled tabpanels. Panel renderers provide title/icon/status/close
  metadata and fill the selected tabpanel; they never read group order or draw their own docking strip.
  The shared `ToggleSegment` (List|Tree, Split|Inline, Preview|Source) borrows the same
  `control-bg-selected` fill + `text-default` for its active segment (no bottom marker — a slim toggle,
  not a tab), so "selected" reads the same everywhere and never derives a parallel surface token.
- The singleton side-tool renderers are **Projects | Specs | Files | Changes | Review**. Their current
  location and local selection are supplied by the shell; Review exposes its store-derived pending-draft
  count as tab metadata. A renderer remains the same when its singleton moves to the opposite side.
- **`ReviewPanel`** is the review sidebar (see [[submodule-server-reviews]] +
  [[task-review-comments]] for the model) — **ONE screen, a per-file ACCORDION**: each row a path +
  draft/sent/resolved counts with a fold chevron; **clicking a row unfolds its comments in place AND
  opens the file's tab** (folding is a second click and navigates nowhere — the row is the only
  toggle; the one other row action is below). A file whose comments are ALL resolved **stays listed**
  until the user finishes it explicitly: the ROW itself grows a **Done check glyph** (inline after
  the counts — visible folded or not; a strip below holding one glyph read as stray space), which
  calls `review.fileDone`, and only that removes the file (`Review.doneFiles`; a new comment
  re-opens it). An unfolded section shows the file's comments in
  the TODO plan's exact section flow, built from the SHARED plan atoms (`chat/planKit`:
  `SectionLabel` + `PlanStatusIcon` — the same pieces `TodoList` renders with). **The reviewer
  agent's comments and the user's ride ONE lifecycle** — the only difference an author badge
  (`review-comment-agent`: a `Bot` + "ThinkRail" chip): they share the same sections, glyphs,
  navigation, per-row send/delete/resolve, and draft counts (`fileDraftIds`/`allDraftIds` and the
  host's implicit `sendableComments` are all author-agnostic; the verdict's fix package still sweeps
  any agent draft the user hasn't already sent). Sections, by status — **Drafts** first (the
  user's actionable, unsent remarks; the call-to-action sits under the file's `Send review (N)`
  strip, not buried below sent rows) → **In
  progress** (the sent — the chat took them; the glyph is GLANCE-AWARE exactly like a TODO's
  in-progress item, via `sessionGlance` + `TodoList.glanceIcon`: working dot / **(?)** while the
  session waits on an `ask_user_question` / pause when it's idle on the user — no loaded runtime reads
  as waiting) → **Resolved** (muted Done styling: primary check + struck hint text;
  the chat action reveals on hover — resolved is final, no reopen). No per-row status words — the section names the status; rows carry
  only the glyph, the clamped text, and the `L3` ref (+ an `outdated` eyebrow when the anchor died).
  The locally selected center resource's section **auto-unfolds** when it is a reviewed file, and an
  expansion never auto-collapses (folding is the user's gesture alone — a send opening its chat tab must not
  fold the section the user was reading); **Drafts rows are numbered** (1., 2., …) instead of wearing
  the pending glyph — and the workbench tool router **reveals the Review tool** when such a tab is
  ACTIVATED (keyed on the local selected-resource change, so a draft saved in an already selected resource
  never yanks attention; `selectActiveReviewedPath` is the shared derivation). Each
  comment row is a **navigation gesture**, one rule for every author: a row with a linked chat
  (`comment.sessionId`) opens **the discussion** (its chat tab); one without — every draft, since a
  draft is never sent — opens the file **focused on the comment**. The file stays one hover-action
  away (the `FileText` glyph runs the file+focus navigation; the chat glyph is gone from open rows).
  The file focus works through (the store's
  `reviewFocusRequest`, consumed exactly once by the pane: Monaco reveals the anchor line — including
  on a fresh mount, via `onMount` — the preview scrolls the in-flow card into view). **No editing
  here** — the in-file card is the editor; the row's action icons (their own layer, never triggering
  navigation) are per-row **Send** (→ `review.sendComment`, opens the created chat tab via the same
  `openChatSession` tail as New Workspace), **Delete for DRAFT rows** (ConfirmPopover →
  `review.commentDelete` — an unsent remark is the user's own scratch), **Open chat** for sent rows
  (reuses the history-reopen flow), and the manual Resolve override (`review.commentUpdate`). **Once
  sent, a comment is a record — no delete, no rollback, no reopen** and resolved is final
  (server-enforced): pushing back on a change is said in a comment, and a fresh remark is a fresh
  comment. **A plain list — no footer**: batch send lives in
  the pane toolbars (`SendReviewButton`) and in the panel itself — each unfolded section's strip
  carries the same per-file `Send review (N)` (`testid: review-panel-send`; `path: null` covers the
  anchorless whole-change-set bucket), the panel header a **`Send all (N)`** across every file
  (`SendAllReviewsButton`, `testid: review-send-all`, over `allDraftIds`; no ids passed — the host's
  "all drafts" is the batch, so the count can't race a concurrent edit). **The header (and its Clear)
  follows the review's RECORDS, not its file rows**: it shows whenever the review holds ANY comment, so
  finishing every reviewed file — which empties the accordion while resolved/sent records live on — still
  leaves a way to close the review (the earlier files-gated header stranded a fully-finished review with
  no Clear). `Send all` stays gated on drafts; **Clear** (`testid: review-clear`) is a destructive
  `ConfirmPopover` that calls the server-atomic `review.close` Clear; the host archives non-draft records,
  discards drafts, replaces the active review, and publishes the fresh empty snapshot, so the initiating
  and sibling clients all converge through `review.changed`. The empty body distinguishes the two empties:
  **records remain but every file is done** ("…finished — Clear to archive…") vs a **truly empty** review
  ("No review comments yet…"). V1 has no archive browser. The review-level
  (overall-note) composer was removed for
  now (the `review` comment kind stays in the model, UI-less). The `review.get` hydration read is **owned by
  the workbench tool integration**, outside the conditionally mounted Review body (`useWorkspaceReview`, the
  `useWorkspaceSpecs` pattern — the read also re-anchors server-side): tab flags and the Review badge need
  the snapshot even while the panel body is unmounted.
  Every client converges on `review.changed` pushes folded into the store; nothing here
  mutates optimistically. Comment *authoring* is **selection-triggered, no mode toggle** (`reviewWidgets.ts`,
  shared by `FilePane`/`DiffPane` through the Monaco components): selecting text shows a floating
  **comment icon right of the selection** (a Monaco content widget; the rendered preview's icon
  follows the selection live but stays mouse-transparent until the drag ends — a clickable node under
  the moving cursor is one the native selection extends into, repainting the document tail). The
  preview icon's position/visibility are **imperative DOM (refs + custom properties + `data-visible`),
  never React state**: the markdown components are per-render-typed, so a state flip mid-drag remounts
  the text nodes under the LIVE selection, which Chrome "restores" by flooding whole blocks — a few
  selected words painted the entire bullet. Outside React, these widgets cannot reach the root
  `TooltipProvider`, so their buttons keep native `title`. Clicking it opens an **inline
  composer under the selection** (a view zone: textarea + Save draft / Send now / Esc cancels). In
  Monaco surfaces the same action also sits in the editor's **right-click context menu** ("Comment on
  selection", right after Copy, `Cmd/Ctrl+Shift+M`; `editorHasSelection` precondition) — the «+» and
  the menu entry are one action pair into one composer (which is why `attachReviewCommenting` takes
  an `IStandaloneCodeEditor` — `addAction` lives only there). The menu's rows wear the app's Remix Icon
  icons via `monacoMenuIcons.ts`: Monaco's standalone menu is label-only (`action.class` icons are a
  workbench feature `addAction` can't reach), so `decorateEditorContextMenus` — installed on EVERY
  Monaco surface, review or not (`MonacoEditor` + both of `MonacoDiff`'s inner editors) — decorates
  the open menu's DOM: each row gets a fixed-width `.editor-menu-icon` slot (labels stay aligned), known
  English labels get their glyph, unknown/restructured rows stay label-only (a Monaco bump can only
  lose icons, never break the menu); submenu popups (Peek ▸) stay undecorated. The rendered preview's
  context menu is the browser's own and stays unextended. Save →
  `review.commentAdd` with only the `lineRange` + the anchor's **side** (the host reads that side's own
  content to fill `contentHash` + the drift-tolerant `textQuote`); Send now additionally fires
  `review.sendComment` and opens the created chat. Commented
  lines render as decorations (`review-comment-line`). Review attaches only for scopes whose modified
  side IS the worktree (branch / uncommitted — never a `commit` scope, whose content is historical).
  **A diff's two editors are two anchor spaces, each carrying the full surface** (decorations,
  in-flow cards, composer): the modified editor holds `side: "worktree"` comments, the original editor
  holds `side: "base"` ones (`useFileReview`'s `base` slice; `MonacoDiff` wires both through one
  `wireSide`, and the tab's `scope` rides along so the host resolves the very blob the original editor
  shows). An original-side selection is **never remapped onto modified line numbers** — the two sides
  say different things at the same numbers, so a remark on a deleted or rewritten line would silently
  re-point at whatever now sits there, and that is what the send package would hand the agent. A focus
  deep link likewise resolves **per side** (`SideReview.focus`), so a surface only ever reveals a line
  it actually renders. The **rendered markdown view comments too**
  (`PreviewCommenting` — the React sibling of `reviewWidgets`, same icon/composer skin, overlays
  positioned in the scroller's content coordinates so they travel with the document): the rendered
  selection is mapped back to SOURCE lines by the pure `previewAnchor` (head/tail phrase search over
  marker-stripped source lines, shrinking phrases at line straddles, never a lone-word fallback for a
  longer selection); an unmappable selection degrades to a **whole-file** comment — the composer says
  so — never to wrong lines. **Saved comments sit IN the document flow, directly below their anchor**
  (the inline-edit-v0 branch's presentation principle, worn in OUR chat-input-family skin —
  `ReviewThreadCard` / its Monaco DOM twin: **the composer's component minus the buttons row** — the
  same card chrome (`border2`/`radius-md`/`bg-dark`, same paddings), no accent bars of its own. A
  DRAFT's body is **editable in place** until it's sent — the same input surface as the composer's
  field (`--input-bg`, primary focus ring; blur / Cmd+Enter saves via `review.commentUpdate`, Esc
  reverts, empty reverts — never deletes) — and carries Send + Delete (draft-only); sent/outdated cards are
  passive read-only markers (plain text, no field). Status shows as the head dot (primary draft / info
  sent).
  **Monaco**: `attachReviewThreads` view zones below the anchor lines — Monaco pushes the following
  lines apart; zone heights track the rendered card via a **ResizeObserver**, not a one-shot measure:
  Monaco keeps an off-viewport zone's node at `display:none`, so a card below the fold at `setThreads`
  time (the markdown tab's rendered→source switch mounts exactly this way) measures 0 and a one-shot
  measure would leave its zone at the placeholder height — the card then paints OVER the following
  lines when scrolled in. The observer re-measures when a card gains real geometry or grows (in-card
  editing), so long comments never overflow. `setThreads` **reconciles zones by comment id** rather
  than tearing every one down and back up on each snapshot: a card whose rendered content is unchanged
  (a `status`/`anchorState`/line-range/`body` signature) keeps its exact DOM, so a draft the user is
  mid-edit survives an unrelated push (another client's comment, a re-anchor/resolve elsewhere) with
  its textarea value, focus and selection intact — only changed cards rebuild, gone ones drop, new ones
  add. **Rendered preview**: `MarkdownPreview` splits the stripped document at each insert's
  anchor and splices it between the markdown segments (`splicedSegments` — the inline-edit split
  pattern; a cut **never divides a multi-line construct**: an anchor inside a fenced code block or a
  GFM table snaps to that construct's last line (`sourceLines`' `indivisibleSpans` + `snapSplitLine`),
  so the card lands *after* the block it comments on and both halves stay whole documents — half a
  fence is not a document, its unclosed opener rendered the whole remainder of the file as code for as
  long as the comment lived; lists and blockquotes divide into two well-formed constructs, which is
  what a card between two items should be; an unlocatable line appends after the document, never
  lost) — the inserts being the saved
  cards AND the open composer (in-flow under the selected block, via `PreviewCommenting`'s
  children-as-function contract; only the transient icon stays floating). **Region parity with
  Monaco**: the blocks under every unresolved comment — and under the composer's target while open —
  wear `.review-region` (`markReviewRegions` — a thin LEFT RAIL only, the gutter-rail half of
  Monaco's decoration; **never a background wash**: a full-block wash read as a broken text
  selection — picking three words in a bullet painted the whole bullet wall-to-wall; leaf-most BLOCK
  elements only). Preview anchoring is **exact**: `sourceLines.ts` (adopted from
  inline-edit) stamps elements with remark source positions in RAW-file coordinates
  (`sourceLineRehype` tuple-form takes each segment's offset — segments re-parse from line 1; via
  `chat/Markdown`'s `rehypePlugins` prop) and the composer resolves selections through the stamps (a
  boundary-only end block is replaced by its previous stamped sibling), falling back to
  `previewAnchor`'s phrase search for unstamped content. The sidebar remains the full-detail surface. **Review presence is self-announcing and
  PER-FILE**: a center resource tab (file or diff) whose path is still in review wears a `Review` flag with
  **two states** (`ReviewTabFlag`, over the one `reviewFlags` derivation) — accent
  (`tr-text-eyebrow text-primary`) while the file holds an **unsent draft**, muted (`text-text-subtle`)
  once only **sent** comments remain; resolved/dismissed drop it entirely. Two states, not
  present-or-absent, because *"in review"* and *"there is something to send"* are different facts, and
  the rest of the review vocabulary already counts draft-**or**-sent as in review (`fileSummaries`,
  `selectActiveReviewedPath`, `fileThreads`) — a drafts-only flag made a file the chat was actively
  working through look identical in the tab strip to one never reviewed, while the rail insisted it
  was in review. **`Send review (N)` stays strictly drafts-only and PER-FILE** — that file's PANE
  TOOLBAR (DiffPane's header,
  FilePane's markdown header — a non-markdown file grows a slim header just for it) carries the text
  button (`SendReviewButton`, over the one `fileDraftIds` derivation): the count and the send are
  exactly THIS file's drafts, batched into the file's own review chat (one chat per file — the host
  pins it in `Review.fileSessions` and later sends `followUp` there), which **opens immediately** (the
  host fires the package into the session detached — see the reviews SPEC's send-latency note). Other
  files' drafts stay put; each pane carries its own button, and the Review panel shows the same
  button in each unfolded section's strip (the panel header adds the cross-file `Send all (N)` —
  see above). Offering it with nothing left to send
  would be a lie, so an in-progress file keeps its muted flag and grows no toolbar. A pane over an
  uncommented file shows neither. There is no manual review mode to enter. Every send affordance (composer Send now, thread cards, sidebar rows/footer, tab
  Send all) goes through the one `reviewSend.ts` pair (`sendReviewComment`/`sendReviewBatch`: request
  → show the chat tab → toast on failure), and the panes integrate via the one **`useFileReview`**
  hook (threads + composer callbacks + card actions in a single `review` prop on
  `MonacoEditor`/`MonacoDiff`).
  A batch answers with EVERY session it touched (one per group), so a multi-file batch opens every chat
  it started and focuses the first — a chat the user never saw would still be an agent working on their
  comments. **Showing each chat forks on the result's `reused` flag:** a chat this send CREATED opens straight
  from the result (`openChatSession` — no round-trip, and its runtime exists before the first streamed
  event), while a **reused** one goes through `openChatInTab`'s tab→runtime→disk escalation, because it
  may be a chat this client has never seen (a second client, or this one after a reload — review state
  and pi transcripts both outlive the host); opening that as new would show a blank conversation for
  comments already marked sent.
  **Sidebar navigation goes to the surface the anchor is READABLE on** (one derivation,
  `reviewModel`'s `ReviewSurface`: `commentSurface` for a row, `reviewFileSurface` for a file row —
  which picks the diff only when *every* unresolved comment on that file is base-side): a `base`
  anchor's lines index the pre-change blob, which only the diff's ORIGINAL editor renders and only it
  mounts `base` threads, so it reopens a **pinned diff on the anchor's own `baseRef`**
  (`GitDiffScope.kind: "pinned"`, wire v30: worktree vs one immutable commit) — never the scope it was
  captured in, which re-resolves against the current fork point/`HEAD` and moves out from under the
  comment when the worktree commits or the review target is re-pointed (the old card would mount on a
  different blob at stale line numbers). A comment saved before `baseRef` was stamped falls back to
  its captured scope, then to the workspace's current one. Routing every row to the file
  tab put base remarks on worktree lines that say something else, with no card and a focus request
  nothing consumes.
- **Live refresh (the worktree panels follow the disk).** Every workspace-scoped read goes through one
  hook — **`useWorkspaceRead(workspaceId, read, handlers, readKey?) → { reload }`** — which owns *when* to read
  (workspace change, that workspace's `fsChangesByWorkspace` tick, a **`readKey`** change, or `reload()` for a manual Refresh) while
  the caller owns *what to do* with the outcome (`onResult` / `onFailure` / `onSwitch`). Centralized because
  each site was otherwise re-implementing the **stale-response guard**: an answer in flight when the caller
  moves on must not land in the new workspace's view (reads are generation-stamped — latest wins, abandoned
  ones stay silent). A `null` workspaceId reads nothing, which is also how a component expresses a
  *paused* read. A visible `FileTree` directory probes while collapsed only as far as needed to identify
  its compact single-directory run; descendants below the run's deepest directory mount and read only
  when that compact row is expanded. No tick has to be threaded down as a prop.
  Its users — `FileTree` (root + each visible directory chain), `ChangesPanel` (`git.status`),
  `useWorkspaceSpecs` (`spec.graph`) — plus `FilePane`/`DiffPane`, which follow the same tick contract per
  open tab. Agent edits,
  terminal commands, and Finder changes all land without a manual step.
  Three shapes keep its effect's dependency list **honest** (no exhaustive-deps exemption anywhere in it):
  the fs tick is consumed as an **event** (`useAppStore.subscribe`) rather than selected into the component —
  so it triggers a re-read without being a render input, and consumers stop re-rendering on unrelated
  worktree churn; the **reset is the effect's cleanup**, which closes over the workspace being *left* (the id
  a reset actually needs — a plain effect keyed on `workspaceId` runs with the *new* id already in scope);
  and a manual refresh is an **imperative `reload()`**, not a nonce dependency. `readKey` is the read's
  **second identity dimension**, for a read parameterized by more than the workspace — `ChangesPanel` passes
  `${scopeKey}:${targetRef}`, so switching the diff scope or re-pointing the target branch resets and
  re-reads exactly like a workspace switch, and one scope's list can never linger under another. `onFailure`
  receives **the rejection**, not just the workspace id: a caller that reacts to one *named* failure (see the
  vanished-commit rule below) must be able to tell it from a timeout or an unnamed host failure.
  The one read that deliberately does **not** go through this hook is `ChangesScopeMenu`'s lazy pair — they
  are *open*-triggered, not tick-triggered — so the menu is instead **keyed by its full identity,
  `(workspaceId, targetRef)`**: its commit rows are `git log <base>..HEAD`, so re-pointing the target changes
  which commits exist, and the remount clears rows that belonged to the previous pair while neutralizing any
  response still in flight for it. Within one mount the pair is **generation-stamped** as well, so two opens
  in a row can't let the earlier answer overwrite the later one. It is
  **identity only** — what makes a re-read happen, never what the read reads *with* (the parameter lives in the
  caller's `read` closure, which the hook re-captures every render, so the value a re-read uses is by
  construction the one the key names). It is threaded to `read` (and `reload`) as an argument for a caller that
  would rather branch on it than close over the parameter; ignoring it — as `ChangesPanel` does, its `scope`
  being an object the key merely names — is expected. Refetches **preserve view state**: `FileTree` re-reads
  the root + the directory probes backing each visible compact row and expanded branch. Expansion lives
  above individual rows and is keyed by every directory path a compact row represents, so shortening or
  lengthening a chain cannot hide descendants that were visible before the refetch; vanished dirs drop out
  via their parent. `ChangesPanel` re-reads
  `git.status` (list-only — the diff renders as a center resource, not under the list), `SpecsPanel`
  refetches without remounting (expansion survives), and `FilePane`/`DiffPane` re-read an
  open resource's content when the workspace ticked past its loaded tick (live while visible;
  background tabs catch up on local selection — only each group's selected body is mounted; a failed re-read — file
  deleted — keeps the last content, no auto-close; a diff tab whose file left the change set likewise
  keeps its last contents — the Changes list is where the disappearance shows). `FilePane` and `DiffPane`
  run the **one** tab-content live-refresh contract — the shared **`useLiveTabContent(tab, {read, applyFresh,
  keepCurrent}, reloadKey?)`** hook — differing only in the read method (`fs.readFile` vs `git.diffFile`) and the store
  workspace-qualified write (`updateFileTabContent` vs `updateDiffTabContent`, each receiving the captured
  workspace because opaque cache ids may repeat across workspaces). Its one-batch skip ("this file isn't in it—just
  advance the tick") requires the batch to have **named** files: a **pathless** frame (`paths: []`, the host's
  ref-move nudge) always re-reads, since path membership says nothing about a change that touched no file —
  that is what keeps an open `uncommitted`-scope diff honest when a terminal `git commit` moves `HEAD`.
  `reloadKey` is the hook's **second live dimension**,
  for a tab whose content depends on something besides the files: `DiffPane` passes `selectDiffTabTargetRef`,
  so re-pointing the review target re-reads a **branch-scope** tab at once instead of lagging until the next
  fs tick (a commit scope has no such dimension — its sides can't move). The re-read keeps the tab's existing
  tick: it answers "what does this tab mean now", it does not observe a file change. The two dimensions are
  two effects, so **two reads can be in flight at once** (a slow tick re-read, then a re-point); both take a
  turn from **one per-tab sequencer** (`createReadSequencer`, unit-tested) and a response is written **only
  while no later read has started**. Otherwise the network picks the winner: resolving out of order, the
  older read lands last and overwrites the newer target's content while carrying its own honest — but now
  stale — stamp, so neither effect sees any drift and the pane keeps the old target's diff under the new
  target's label indefinitely. Dropping the superseded read costs nothing: the read that superseded it is
  the one the user is waiting for. Panels are mounted only for the active workspace,
  so scoping is natural. A degraded host watcher pauses automatic invalidations until the next workspace
  read re-establishes it; editable-file conflict handling waits for `fs.writeFile` (the viewer is read-only today).
- **`useWorkspaceSpecs` owns the `spec.graph` read** (one fetcher, one definition of "this file is a spec"):
  the snapshot lands in the store (`specsByWorkspace`), not panel state, because the chat's turn divider
  needs the same answer to route its chips. It is called by **the workbench tool integration**, not by `SpecsPanel` — the
  panel body only exists while its tab is showing, so owning the read there would mean a user sitting on
  Changes stops the graph tracking the worktree, and every spec the agent writes gets counted as a changed
  file (the split silently undone by a tab selection). Being keyed per workspace, a switch shows that
  workspace's last known tree while the re-read is in flight (there is nothing to reset), and the failed-read
  flag is workspace-scoped so it can't leak a hint over a sibling's good tree. It returns `{ failed, reload }`
  — `SpecsPanel`'s error-only Retry calls `reload` directly, so no retry counter has to be held in panel state.
- `SpecsPanel` is the read-only spec-graph viewer — a pure reader of that snapshot. One fetch per
  workspace activation, refetched automatically on the fs tick, rendered as the **`parent` tree** (roots =
  no/dangling parent; default-expanded). There is **no persistent Refresh control or panel toolbar row**:
  routine synchronization is automatic. A fetch **failure renders a distinct inline error hint with Retry**,
  never the "No specs" empty state — offline and empty are different answers. With a previous snapshot, the
  hint sits above the retained tree; without one, it replaces the loading state. The tree build (`specTree.ts`)
  assumes a well-formed graph — **parent cycles are `spec_validate`'s problem, not the viewer's** (cycle
  members are unreachable from any root and simply don't render) — but the walk is **visited-guarded**,
  so a malformed graph can never hang or loop the UI. Tree only in this slice — no cross-edge display,
  no editing, no validation badges, no graph canvas.
- `SpecsPanel` is a compact **document-first tree**: spec nodes are container **and** document, so the
  controls make both roles explicit. Hierarchy uses fixed per-depth indentation + chevrons, deliberately
  **without connector rails or branch elbows** (persistent lines overloaded the narrow rail). The padded
  **chevron alone** expands/collapses, while the rest of the row is a native document button whose
  **single click previews** the rendered spec — and whose **double click keeps** it — through the same
  `fs.readFile` → `openTab` flow as `FileTree` (see the Preview tabs bullet; reading down a spec graph is
  the case the reusable slot exists for). Every row stays on one line: indentation → chevron →
  shape-coded role icon → truncated title → trailing role (`ARCH` / `MODULE` / `SUBMODULE` / `TASK`;
  unknown types degrade compactly). The role is **revealed on row hover/focus**, untruncated, and the
  `aria-label` carries it unconditionally. Titles render through `specDisplayTitle`, which collapses a
  title's ` — ` / ` – ` separator to **` · `**. The top-level `goal-and-requirements` row
  instead carries the exact **`Main spec`** label and distinct root icon; a locally selected file resource's row has a persistent selected
  treatment. **Lifecycle status is not presented at all** — future lint health arrives with a real linter
  feature, not speculative dots or reused status chrome. This remains a restrained hierarchy — no hero,
  duplicate root, preview pane, or graph canvas. `FileTree` shares the same file gesture model
  (preview/keep) but keeps its own directory behaviour — a whole-row click toggles dirs, no collision
  there.
- **Chat deep-links remain arrangement-agnostic.** A shell-owned **`LayoutIntent`** names the singleton tool;
  the shell resolves its current side/group, reveals it in place, and selects it locally. `changesRequest`
  and `specRequest` add the one path to focus/open without naming a layout destination. A divider chip that
  only reveals a tool therefore needs no fabricated path or fixed-right-panel assumption.
  `ChangesPanel` watches `changesRequest` (set by a chat turn-divider's "files changed" chip),
  **highlights** the requested file's row (resolved with `matchesWorktreePath` against `git.status`) **and
  opens its diff tab** in the destination center group's **preview slot** — the chip/list-row click *is* the
  user's explicit ask to see
  that change, so stopping at a highlight read as broken, and following a chip is browsing, same as clicking
  the row it points at, so it reuses the slot rather than accumulating a kept tab per chip. A path no longer
  in the current diff (a round from days ago) degrades to highlight-only: there is no diff to show. **So does
  a deep link the user has already navigated past** — this open is the one that *cannot* mark its own
  navigation when it happens, because the path is only resolvable once `git.status` lands and the chip is
  normally what reveals this view (a fresh mount, a full round trip). The destination group id and local
  navigation clock stamped at the click are what it compares against, so a tab the user picked while
  the list was loading is the later navigation and keeps focus. The
  intent is **consumed** (`clearChangesRequest`) once handled — it opens a center resource, so a git-status
  re-read replaying it would yank the user's tab back. `SpecsPanel` watches **`specRequest`** (the "N specs"
  chip) and **opens the rendered spec**, likewise in the destination group's preview slot
  (`openFileInTab`, which canonicalizes the reported path — pi may report it absolute or `./`-prefixed — to
  the worktree-relative **tab identity**, so a deep link can never open a second tab for a file already open
  under its relative path; that lives in the choke point, not in each caller, and it means a spec created
  seconds ago and not yet in the graph opens just the same) — a spec has nothing to preview short of its
  content, and the tree row lights up from the local selected-resource identity. That intent is
  **consumed** (`clearSpecRequest`) once handled: like the Changes link, it opens a center tab, so
  replaying it on a remount or a graph refetch would yank the user's tab back mid-edit. Two intents, two
  effects: a spec chip must never land in the git-derived Changes view, which structurally cannot show a
  gitignored `.thinkrail/context/` scratch spec — the empty-Changes bug that motivated the split.
  Both intents carry **exactly one path**: a round that wrote several artifacts resolves the ambiguity in the
  chat (the chip expands into a list there — see chat/SPEC.md), so no panel ever has to mark a *set*. That is
  deliberate — a second, round-scoped marking vocabulary over these workspace-scoped trees would reintroduce
  the two-rows-read-as-selected ambiguity the single-selection rule above exists to prevent.
- **The diff scope is chosen in the Changes header, and enters the tab's identity.** Two header controls say
  what is being diffed: the **`ChangesScopeMenu`** pill — *All
  changes* (the workspace's work since diverging from the target branch — measured from the merge-base,
  so upstream commits landing on the target are never phantom rows here; the default) / *Uncommitted changes* / one **commit** from the
  branch's list — and the shared **`BranchPicker`** pill for the **target branch** (`workspace.setDiffBase`;
  the panel converges on the broadcast `workspace.updated`, never optimistically). The menu's contents load
  **lazily on each open**, never on panel mount: `git.listCommits` for the commit rows (subject +
  `shortSha · author · relative time`) and a `git.status` probe under the uncommitted scope, which is what
  lets the *Uncommitted* row say “No uncommitted changes” (disabled) instead of opening an unexplained empty
  list; each degrades on its own. The menu content is **height-bounded and scrollable** (on the shared
  `DropdownMenuContent` primitive, since any long menu has the problem) — 200 commit rows must not run past
  the viewport edge where they are unreachable. The pill names a commit scope by its **short sha**, never its subject
  (`scopeLabel`; the subject is the trigger's `title` via `scopeTitle`, and the menu row shows it in full) —
  a sentence in a rail header squeezes the sibling target-branch pill down to an ellipsis. A scope naming a commit the repo no longer has (rebase, branch reset) makes
  the host reject `git.status` with the **named** code `UNKNOWN_COMMIT` (`wsErrorCode`), and *that* rejection —
  and only that one — **resets to the branch scope with a toast** rather than staying wedged on a dead sha.
  Every other failure (timeout, prolonged network outage, git error) leaves the user's chosen scope alone, keeps the
  last good list, and says so once per failing streak: silently swapping the scope on a network blip is a
  worse lie than a stale list. The code exists precisely because "the read failed" cannot distinguish the two.
- **"Never answered", "failed", and "answered empty" are three states, never two.** The panel holds the
  `GitStatus` *and* a failure separately: no status yet reads as **Loading…**, a failure with no list to keep
  renders the error plus a **Retry** (`changes-error` / `changes-retry`, `reload()`), and only a landed answer
  whose `changes` are empty may say “No changes in this scope.” (`changes-empty`). A failed first read must
  never take the empty-state branch — “clean” is a *claim about the worktree*, and a read that didn't land
  made no claim; a review surface that shows clean when it isn't is this product's worst failure. Same rule
  on the host side: a non-zero `git diff` exit **throws** instead of yielding an empty change set (see
  `server/src/git/SPEC.md`). The **target branch lives beside the scope menu, not inside it**
  (as first designed): a searchable list belongs in a combobox, and a nested Radix submenu closes itself when
  the menu re-renders as those lazy reads land. **A narrow pane drops the target pill before it drops
  legibility.** Both pills are `min-w-0` so their labels truncate, which also lets them shrink below their
  own icons — and icons that no longer fit spill onto the neighbour. The header is a `@container`: under
  `16rem` the target pill is `hidden` (the scope pill keeps its icon and the widest label the room allows),
  and the left cluster is `overflow-hidden` so whatever still overflows clips instead of overlapping.
- **The diff is a center resource tab, not an inset inside the Changes tool.** Clicking a Changes row fetches `git.diffFile` (both sides of
  the row's scope) and opens a **`DiffTab`** (`${workspaceId}:diff:${scopeKey}:${path}` — one tab per *file and
  scope*, carrying its own `scope`: a re-click in the same scope focuses the existing tab, while the same file
  in another scope is a second tab, because a tab's content must never change meaning because the Changes scope
  flipped underneath it; non-default scopes tag the tab label via `diffTabName`) through `openTabs.ts`'s
  **`openDiffInTab`**, the diff twin of `openFileInTab`: a single click **previews**, a double click **keeps**,
  so scanning a change set reuses one tab. `DiffPane` renders a slim
  header — the **path chip** (muted directory prefix + bright basename, matching the flat list's rows), a
  **¶ hide-whitespace** toggle (Monaco's `ignoreTrimWhitespace`, per tab via
  `store.setDiffTabIgnoreWhitespace`), a **copy-contents** button (the modified side; no clipboard → no-op,
  the text stays selectable), and the per-tab
  **Split | Inline** toggle via `store.setDiffTabView`; **until the user picks, the default follows the
  pane's width**: `diffLayout.narrowForSplit(paneWidth, editorFontSize)` (unit-tested) says a pane whose
  halves would each show fewer than 40 monospace columns — line-number chrome deducted, the editor's own
  font size read through `editorFont` — defaults to Inline, wider panes to Split, and the choice re-derives
  live as the pane is resized. A click on either segment writes `view` and pins it for that tab. The
  toggle always shows the effective view, which is why this lives here and not in Monaco's
  `useInlineViewWhenSpaceIsLimited` (kept `false`): Monaco's switch flips the rendering while the segment
  still says Split — over the read-only lazy
  `MonacoDiff` (`@monaco-editor/react` `DiffEditor`, model paths derived from the file's path so both
  sides highlight alike; **`hideUnchangedRegions: { enabled: true }`** —
  Monaco's own collapsed context (“N hidden lines” with an expand control, in both layouts), never a
  hand-rolled folding of our own; the inline view's dual line-number gutter
  — base-branch no. left, worktree no. right — is Monaco's standard and stays; on unmount it sets
  **`keepCurrentOriginalModel`/`keepCurrentModifiedModel`** so `@monaco-editor/react` won't dispose the
  models early, and then disposes the **widget before its two models itself** — the only order that dodges
  Monaco 0.52+'s "TextModel got disposed before DiffEditorWidget model got reset" assertion (disposing a
  model while a live widget still references it), which the library otherwise trips by disposing models
  first; keeping them also avoids leaking a model pair per closed diff tab (regression-pinned in
  `e2e/changes.spec.ts`)). **A markdown diff has exactly two
  views** instead, via a **Source | Rendered** toggle (`diff-toggle-source`/`diff-toggle-rendered`,
  per-tab `DiffTab.rendered` via `store.setDiffTabRendered`, gated on `lib.isMarkdownPath`; Source is
  the default — no Split|Inline segment for markdown). **Source** = the same Monaco diff, and it obeys the
  same `narrowForSplit` default as every other file: the segment is what markdown lacks, not the fallback.
  It used to be pinned to `split`, which is the one combination with no way out — a narrow pane wrapped both
  halves to a few characters each and carried no Split|Inline segment to escape with.
  **Rendered** is a **real rich diff**, not plain previews (see [[task-rendered-markdown-diff]]): the
  lazy `RenderedDiff` renders **both sides** through the same document pipeline as `MarkdownPreview`
  (the shared `MarkdownDocument` — prose skin, alerts, heading ids, frontmatter stripped) plus the same
  `FrontmatterProperties` block the file viewer shows above it, to static
  HTML (`renderToStaticMarkup`; effects don't run, so code blocks show the plain fallback and link
  handlers are inert — accepted for a diff view), then merges them with **`node-htmldiff`** into ONE
  document carrying `<ins>`/`<del>` markers (`del` red + strikethrough, `ins` green — token colors),
  injected via `dangerouslySetInnerHTML` (same accepted risk class as the shiki path in
  `chat/Markdown`). **The htmldiff merge runs in a Web Worker** (`htmldiff.worker.ts`, one worker per
  pending request — terminate = cancel): htmldiff's matcher is super-linear on repetitive content
  (seconds of synchronous blocking for a few hundred near-identical rows), so it must never run on the
  main thread; while it computes, `RenderedDiff` shows a `rendered-diff-loading` placeholder, and a
  worker failure (script asset failing to load, htmldiff throwing) shows a `rendered-diff-error`
  placeholder pointing at the Source view — never an eternal spinner. The
  static-markup render of both sides is linear and stays on the main thread. Pinned by e2e in
  `e2e/changes.spec.ts`: the long-task test (seeded `LARGE.md`, 800 identical rows), the
  worker-failure test (worker asset blocked → `rendered-diff-error`), and the live-edit test (fs
  tick re-reads both sides → stale merge cancelled, fresh one lands).
  **The properties block goes *through* the merge, not beside it.** Rendering it into each side's static
  markup means a changed `status:` wears the same `ins`/`del` marks the prose does, for no machinery at
  all — a diff that showed only the new frontmatter would hide exactly the edits a spec review is looking
  for. `FrontmatterProperties` takes `onEdit` as optional and renders a read-only key/value list without
  it, which is also what makes it safe here: `renderToStaticMarkup` runs no effects, so an editable
  control in a diff would be a widget that silently does nothing.
  **The rendered view carries the outline too** (`diff-toggle-outline`, per-tab `DiffTab.outlineOpen`),
  the same `OutlineColumn` the markdown file viewer uses, read from the **modified** side's source and
  scrolling by heading id. It renders only in the rendered view: the Source view is a Monaco diff with its
  own navigation, and a control renders only where it can act. This mirrors VS Code's opt-in "markdown preview in the diff view" — a feature of
  VS Code's webview layer, absent from standalone Monaco, hence built here. A row is shown selected when its
  diff resource is locally selected in a center group (or it is the deep-link highlight). A failed
  `git.diffFile` leaves placement unchanged (the row stays for a retry).
- **Changes: List | Tree.** A header toggle (`store.changesView`, app-wide — persisted in the store, not
  per workspace, so it survives workspace switches) switches the flat **List** and a folder **Tree**
  (`ChangesTree`), both built from the same `git.status` list. The Tree is styled exactly like the
  Files tree (shared `TreeRow`); folders **default expanded** (change sets are small), and a
  single-directory run is one slash-joined compact row (based on the changed-file tree, regardless of
  unchanged siblings on disk), matching `FileTree`. **Status is shown on the file name, not a letter glyph**
  (the git-decoration convention — `changesModel.statusNameClass`, shared by both views):
  added / untracked → green, deleted → red + strikethrough, renamed → blue, modified → plain. Each file
  and folder also shows a `+N −M` badge (shared `DiffStatBadge`) — per-file counts come from `git.status`
  (`GitFileChange.added/removed`, from `git diff --numstat`; untracked files count their whole content as
  added — but a binary or oversized untracked file gets no count, mirroring how tracked binaries drop out
  of `--numstat`), folder counts are summed client-side. Both views share `ChangesPanel`'s `openDiff` + `isActive`.
  The **List shows the full worktree-relative path** — muted directory prefix (which yields first when the
  row overflows) + the status-colored basename, so the name a user scans stays visible.
- **Browsing reuses one tab per center group: preview versus keep.** Each workspace view has one local
  preview identity per frame group; its label is italic and carries `data-preview="true"`. Single-clicking a file/spec/change row or
  following a rendered-document/chat artifact link opens into the browser's last-focused destination group
  as preview. Double-click keeps; clicking an already active preview keeps as the touch path. An explicit
  Settings/open-as-file action starts kept. Chat and registered plan/document tabs never enter preview.
  The strip and
  context/command surfaces also expose a keyboard-operable Keep Preview command.

  **Previewing at all is a local layout preference** (Settings → Layout, `previewTabs`, on by default).
  With it off `openTabs.ts` reads every open as a keep, so nothing claims a slot and no click waits out the
  double-click window to learn whether it was one — the single choke point is where the intent enters, not
  each of the a dozen callers that form one.

  A preview replaces only that group's slot at the same index, so browsing never reshuffles the strip. A
  double click composes preview then promote; `openTabs.ts` single-flights the underlying read and carries
  the leading click's slot claim into one final kept local transition, so no intermediate preview state is
  persisted and network latency cannot reverse the intents. Freshness stamps (`loadedTick`, plus a diff's `loadedTarget`) are
  captured before the read leaves, never from newer state at response time. The local per-group navigation
  clock is captured at request time: a stale preview completion loses to later attention; deliberate keep
  still commits. If the destination group disappeared, the shell reroutes to current last focus, and if a
  a newer local transition already placed the canonical resource, completion selects that placement instead
  of duplicating it. Preview placement and attention commit locally. Unit and E2E tests pin double-click
  coalescing, stale-read rejection, per-group isolation, local identity convergence, and
  promote-by-keyboard/touch.
- **A live tab keeps its workspace watched.** `useLiveTabContent` asks the host to watch the workspace
  for real (`transport.watchWorkspaceForLiveContent`, the non-prewarm path) while it is mounted. Freshness
  arrives entirely through `workspace.fsChanged`, and the rail's prewarm watches are **evictable** — past
  eight of them the oldest is dropped — so a tab could sit there promising live content over a watch
  nobody had claimed. The call is idempotent and single-flighted by the same `skillLoad` preparation every
  session read goes through.
- **Row actions: one menu, two triggers.** Every **file** row (both views) is wrapped in
  **`ChangeRowActions`**: a hover/focus-revealed `⌄` button *and* right-click on the row open the same
  dropdown. The `⌄` is not garnish — it is the **touch path**, where right-click does not exist (mobile-first).
  Items: **Show diff** (the same action as a plain click), **Jump to source**, and **Copy path**
  (worktree-relative). Jump to source opens the *file*, not the diff of it, **kept** rather than previewed —
  leaving the changes list to edit something is not browsing — and takes IntelliJ's name for it. It is a
  menu item and nothing else: no chord, because the app's key bindings are a shared surface and this panel
  does not get to claim one on its own. The row's own click stays the diff: reading a change is what the
  panel is for, and editing it is the second thing you want, not the first. Deliberately
  nothing else: the panel is **read-only** — no discard-file/-folder/-all — and no “Open in ‹external app›”,
  which a host-side `open` would make silently wrong for every remote/phone client (Copy path is the portable
  escape hatch). **Folder rows get no menu** — nothing in that list applies to a folder. Built on the existing
  `components/ui/dropdown-menu` (no new `context-menu` primitive); the right-click handler is handed back
  through a render prop so it lands on the row's real interactive element rather than a bare div, and the `⌄`
  trigger is a *sibling* of the row's button (a button inside a button is invalid).
  Three layout rules make that wrapper invisible rather than a seam — each pinned by a geometric e2e
  assertion, because each was a real bug the first draft shipped:
  **(1) the wrapper owns the row's highlight** (hover / selected / menu-open), since the band has to span the
  trailing slot too or a row reads as cut off before its own menu — the inner element paints **no** background
  at all (the flat list's button carries no `hover:`/selected class, and `TreeRow` takes
  `highlight="wrapper"`, its `"self"` default being what the Files tree wants). Exactly one painter,
  always: two hide the case where the wrapper stopped painting, which is why the e2e pin compares the *wrapper's*
  computed band against the *inner button's* (transparent) one, not a wrapper against a wrapper;
  **(2) rows *without* a menu reserve the same gutter** (`ROW_MENU_SLOT`, exported from `ChangeRowActions`
  and worn by the tree's folder rows), or the `+N −M` column sits 24px further right on folders than on
  files; and **(3) a row shares its flex line with that slot, so it must be able to shrink below its label**
  — `TreeRow` carries `min-w-0`, and every path is rendered as *two truncatable halves* (dir + basename), so
  a long basename can never push the counts (or, in `DiffPane`'s twin chip, the ¶/copy/layout controls) out
  of the box. The halves are **not** equally truncatable: the dir prefix yields **completely** before the
  basename gives up a pixel, because the name is what a user scans. That ordering is *structural* — the dir
  is the only shrinkable item (`shrink`), the basename is `shrink-0` — not a shrink *ratio*. A ratio (this
  was `shrink-[20]` vs `shrink`) only approximates it: flex splits the deficit in proportion to factor ×
  basis, so the basename always loses a slice, sub-pixel at a small type scale and ~2px at 14px — which is
  how a 12-character `shortName.ts` picked up an ellipsis when the UI scale rose. The e2e pin measures the
  two spans separately, so "the dir yields first" stays a claim a test can falsify. `shrink-0` **alone**
  would overflow the chip **invisibly to the layout** while spilling over the buttons on screen, so the
  basename pairs it with `max-w-full`: flex never steals the name's width, but max-width still clamps it to
  the row, which is also why the e2e pin measures the *chip's* `scrollWidth`, not the header's.
- **Markdown file tabs render, don't read.** A `.md`/`.markdown` `FileTab` (from the file tree **or** the
  Specs panel — same `openTab` path) opens **rendered by default**: `FilePane` gates on `lib.isMarkdownPath`
  and shows a slim `Preview | Source` header (`markdown-view-toggle`), the rendered view being lazy
  `MarkdownPreview` (reuses `chat/Markdown` for GFM+shiki but owns the **document skin** — `tr-prose-doc`
  supplies every typography value (`typography.json` → `proseSystems.doc`: h1–h4 at 24/20/18/16 against
  14px body copy, so a rendered file reads as a document rather than a chat bubble), and the skin adds
  only what is *not* typography: h1/h2 section rules, a capped reading measure (~78ch) with wide
  tables/code scrolling inside it, zebra-striped bordered tables, muted accent blockquotes, crisp
  rules, and **GitHub-style alert callouts** (`> [!NOTE]`…`[!CAUTION]`, via the in-repo
  `markdownAlerts` remark transform + a Remix Icon/token `AlertCallout`, wired in only here — not chat), and
  **```mermaid fences render as themed diagrams** (the shared `Markdown` primitive's mermaid path —
  `chat/SPEC.md`; the rendered *diff* keeps the source-code degradation, like shiki) — in
  a centered reading column; strips a leading YAML frontmatter block via
  `lib.stripFrontmatter` so a spec's metadata doesn't render as a stray heading — source view still shows
  it) and source being the lazy read-only `MonacoEditor`.
- **Frontmatter is an editable properties table at the top of the Preview** (`FrontmatterProperties`, an
  Obsidian-style block: key/value rows, list values as chips, add/rename/remove, collapsible per mount).
  It sits **inside** the scrolling document — first child of the scroller on both the plain and the
  reviewed path — so it scrolls away with the prose instead of holding a frozen band of the pane. Metadata
  is what a reader passes on the way in, not something worth the height on every screen of a long spec.
  Text, sequences, and one-level mappings — `frontmatter.ts` parses top-level `key: scalar`,
  `key: [a, b]`, block lists of scalars, and one level of `sub: scalar` entries; **a flow sequence spread
  across lines** (`key:`, then `[`, its items, `]`) reads as the same list, because the spec files this
  table exists for are generated in exactly that shape and treating it as unreadable turned every one of
  them into a raw block. It is saved back as a block list, the canonical form the serializer already
  writes; an unclosed one is still refused. Any other YAML shape
  (deeper nesting, duplicate sub-keys, anchors, multiline) keeps the **whole block read-only** rather
  than risking a rewrite that drops what it did not understand; a duplicate-key rename is refused for
  the same reason. An edit rebuilds the frontmatter through `withFrontmatter` and lands as
  the tab's **draft** — the same lifecycle as typing in Monaco (dirty dot, save, conflict bar), which is
  why the block only renders when `onContentEdit` is wired and why removing the last property removes the
  fence. A `type` or `status` value carries a native `datalist` with the spec-node vocabulary (`type`
  from `specTree`'s known roles) — suggestions, not constraints, since the properties view is for any
  markdown and only spec nodes speak that vocabulary. Each row leads with a **value-type menu** named in
  YAML's vocabulary — Text, Sequence, Mapping — that converts on switch, loss-visible rather than
  lossless: a structure becomes its inline reading as text (`[a, b]` / `{k: v}`, quoted on serialize so
  it stays a scalar), a text becomes one item, and mapping ⇄ sequence goes through `key: value` items so
  a round trip survives (ordinal keys when items don't split). Picking the type a row already has
  changes nothing — not even formatting.
  `frontmatter.test.ts` pins the round-trips; `e2e/frontmatter.spec.ts` drives edit→draft→Source,
  chips, folding, the type suggestions, and the read-only fallback. The choice
  is a per-tab `store.setFileTabView` (survives tab switches; not persisted across reload). Non-markdown
  files render Monaco directly with no header, exactly as before.
- **PDF tabs are a plugin's concern.** `packages/plugin-pdf-preview/SPEC.md` owns the pdf.js rendering,
  zoom, and text-layer details; core only supplies the mechanism (`selectFileViewer`, `FileViewerProps`,
  the worktree-scoped `/files/…` byte route) any file viewer plugs into.
- **Image tabs render bytes over their own route, not tab content.** `FilePane` gates on
  `selectFileViewer(tab.path)?.read === "none"`, with `coreViewers.ts` registering `lib.isImagePath`
  (png/jpe?g/gif/webp/svg/bmp/ico/avif, `kind === "file"` only) as its `matches` — `FilePane` renders
  `ImagePreview`: one `<img>` on `worktreeFileUrl` with the shared byte-revision cache-buster, the natural
  dimensions in a toolbar with zoom (±/reset buttons, pinch and ⌘/Ctrl+wheel via `lib/zoomGesture`, a
  percent readout) and a reload-from-disk button. Zoom multiplies a fit width measured once per load
  (100% = natural size capped to the pane — CSS `zoom` was tried and cancels against `max-width: 100%`);
  the fit is not re-measured on pane resize. No lazy import (there is no library) and no transparency
  checkerboard. `openFileInTab`/`useLiveTabContent` skip the `fs.readFile` round trip for an image path
  entirely rather than decoding binary as UTF-8 for a `tab.content` nothing reads. A
  `?t={byteRevision}.{reloads}` query param is what makes it track the file, exactly as the pdf-preview
  plugin's own viewer does — see that plugin's `SPEC.md` for why the revision is the file's own byte
  tick rather than the workspace's `loadedTick`.
- **Rendered markdown navigates.** In the preview, links + images resolve against the file's own path
  (via `markdownLinks`, passed as the `a`/`img` renderers): a **relative link** opens the target file in
  the **preview** tab through the shared **`openFileInTab`** (the same flow `FileTree` uses) — following a
  link is browsing, so the slot is reused rather than promoting the source doc the way VS Code does; an
  accepted file target is a button styled as document-link text, never an anchor with a raw relative
  `href`, because that URL is not a ThinkRail route and native navigation would escape to the Main page;
  URL pathnames are decoded once and both path-separator forms are normalized before resolution, while
  malformed encoding and traversal above the worktree root produce an inert control instead of opening the
  wrong file; the slot is the slot, whatever
  the open came from — an **in-doc `#` link**
  scrolls the preview (headings carry slug ids from the in-repo `remarkHeadingIds` transform), an
  **external** link opens a new tab, and a **relative image** rewrites to the host **`/files/…`** route
  (built from `transport.httpBase()`). A cross-file link's `#fragment` is not yet followed (opens the
  file only).
- **Source lines wrap at the synchronized file column.** Every ordinary `MonacoEditor` and both inner
  editors of `MonacoDiff` use `fileLineWidth` as `wordWrapColumn` (40–240, default 120). The independent
  `fileLineWidthBounded` default maps to Monaco `wordWrap: "bounded"`, wrapping sooner at each mounted
  editor pane; off maps to `"wordWrapColumn"`, preserving the selected column with horizontal scrolling in
  a narrower pane. Broadcast changes update mounted editors. Rendered Markdown and rendered Markdown diffs
  retain their separate ~78ch reading measure; no bytes, ruler, extension mask, or no-wrap mode is involved.
- **The Outline toggles inline, in the same header as Preview/Source — a fourth control, not a new
  layout region.** `LayoutToolId` is a closed set (`shell/layout/SPEC.md`); an Obsidian-style heading
  tree earns its own panel only if it needs to outlive the tab it belongs to, and this one doesn't. The
  toggle (`md-toggle-outline`) is per-tab state (`FileTab.outlineOpen`, `store.setFileTabOutline`) so it
  survives a tab switch without a store migration, and shows in every view — the outline lives at the
  *pane's* left edge, Overleaf-style, outside the Preview/Source/Split switch, so Split gets
  `[outline | editor | preview]` and Source keeps the outline as an editor navigator.
- **The shared outline furniture (`Outline.tsx`'s `OutlineToggle`, `OutlineColumn`, `scrollToHeading`) has
  a plugin consumer.** The Blueprint plugin's pane composes them the way `FilePane` does, and its
  passage-selectable-text-first, click-to-edit-second behavior (`EditableText`, since a paragraph
  announced as a button breaks both selection and screen readers) is the same shape this pane's own
  `EditableText` uses. Its own heading scan and `data-md-line-*` selection reporting live in the plugin
  now (`ctx.editors.reportSelection`, `plugin-api/SPEC.md` W12) rather than this module's
  `sourceHeadings`/`reportIdeSelection` — see `plugin-blueprint/SPEC.md`.
- **The outline is read from the markdown source, not the rendered DOM.** It once queried `h1[id]…h6[id]`
  in the rendered document (an earlier revision of this section documents why AST ids can drift in the
  review path), but the Overleaf jump needs each heading's *source line*, which only the source knows —
  and in the Source view there is no rendered DOM at all. `outlineTree.sourceHeadings` scans ATX headings
  (fences skipped, frontmatter offset added) and derives the same slug ids the document renders
  (`slugify` + the `remarkHeadingIds` dedupe walk), so preview jumps still land by id; in the review
  path's *segmented* render — where per-segment dedupe counters can shift an id — the jump falls back to
  the `data-md-line-start` stamps that render carries. Setext headings are not scanned. Ids can differ
  from the DOM for headings containing markdown links; both are accepted ceilings.
  `outlineTree.buildOutlineTree` nests the flat, document-order result by level — closing every open node
  at ≥ the incoming level — and is the only place a heading skip (h1 straight to h3) is resolved.
- **Clicking an entry jumps both sides and selects neither.** The preview scrolls via the same
  `getElementById` + `scrollIntoView` used for in-doc `#` links; the editor reveal rides the existing
  `focusLine`/`onFocusHandled` seam on `MonacoEditor` through pane-local state, so an outline jump is
  indistinguishable from a link-opened line. In views where one side is absent, the other still jumps.
- **The outline column makes the pane body a flex row, so the view slot needs `min-w-0`.** A flex item
  defaults to `min-width: auto` and therefore refuses to shrink below its content — the scroller grows
  past its pane and an ancestor clips it, which looks like "horizontal scrolling is broken" (headings and
  prose cut off at the right edge, nothing to drag). Prose is meant to *wrap*; only a wide table scrolls,
  inside its own box. `e2e/editor.spec.ts` pins all three: the scroller fits its pane, the document does
  not overflow sideways, and a wide table does. It also covers the toggle, asserts an entry's
  `data-heading-id` matches a heading that actually rendered, and drives an outline click that reveals
  the heading's line in Monaco.
- **Code surfaces re-theme from generic tokens, resiliently.** `MonacoEditor` defines the `thinkrail`
  theme from live surface + semantic syntax variables and chooses its normal/high-contrast base from
  manifest appearance/contrast metadata—never from a known id—then redefines it after the theme module's
  atomic `[data-theme]` signal. Reads are canonicalized to hex (`lib.cssColorToHex`; unparseable values
  are dropped), and a bad value degrades to Monaco's base palette rather than crashing the panel.
  `TerminalInstance` similarly rebuilds from the complete 16-slot ANSI variable set; both consume the
  nullable editor selection-foreground override when provided. `MonacoDiff` re-themes exactly like
  `MonacoEditor` — both consume `monacoSetup.ts`'s define + observer, so a palette swap lands in the
  diff tab too.
- **An issue number is not a colour.** Monaco's colour decorators are off too (`colorDecorators: false`
  in `sharedEditorOptions`): its CSS-family colour provider paints a swatch before any `#rgb`-shaped
  token, comments included, so `/** GH #130: … */` in a stylesheet grew a dark square. A swatch in a
  code buffer earns nothing here that the rendered preview does not do better.
- **Cyrillic prose is not a homoglyph attack.** Monaco's ambiguous-Unicode highlight is off in
  `sharedEditorOptions`: flagging every Cyrillic с and о as a potential attack boxes half the letters of
  a Russian document, and the editor's files are the user's own worktree, not untrusted paste.
- **The terminal is built one commit after the tab switch.** Constructing xterm (four addons, `open()`)
  costs ~90ms before it can even send `terminal.attach`, and doing it in the commit that selects the tab
  makes the switch itself wait on all of it — the old tab stays on screen for the duration. Mounting is
  therefore gated behind a passive effect, which runs after that commit is painted: the new tab appears
  first, the terminal fills in the panel already on screen. The gate must be an effect and **not**
  `requestAnimationFrame`, which never fires while the window is occluded or minimised — a terminal opened
  in a hidden window would then never start at all. Paired with the layout module keeping recently used
  terminals mounted, so this cost is paid once per terminal rather than on every switch.
- **Extended keys are negotiated, not assumed** (`extendedKeys.ts`). Enter and Shift+Enter are the same
  byte (`\r`) in a plain terminal, so a TUI cannot offer "newline" separately from "submit". Terminals
  answer this by letting a program *ask* to tell modified keys apart, and xterm.js implements neither
  request — so we do: `CSI > flags u` / `CSI < u` (kitty keyboard, a stack) and `CSI > 4 ; level m`
  (xterm modifyOtherKeys), each answered in its own encoding (`CSI 13;2u`, `CSI 27;2;13~`).
  **Nothing unusual is sent to a program that never asked**, which is why emitting `ESC CR`
  *unconditionally* — the binding `/terminal-setup` writes for VS Code — was wrong: outside an app
  expecting it, an ESC-prefixed Enter is a readline meta sequence and does something unrelated. Only keys
  a terminal genuinely cannot disambiguate are reported (Enter, Tab, Backspace) and only while modified;
  everything else keeps meaning exactly what it meant. A key handled here calls `preventDefault` before
  returning false: that return tells xterm not to process the key, which also skips the `preventDefault`
  it would have done — so Tab kept moving focus through the workbench while its bytes went to the shell.
- **An agent CLI that negotiates nothing still gets its newline.** Claude Code asks for neither protocol
  (verified against 2.1.258: it enables bracketed paste, focus events and mouse tracking, and no keyboard
  mode at all), so negotiation alone leaves Shift+Enter indistinguishable from Enter and its multi-line
  input unreachable — which is exactly why `claude /terminal-setup` exists, and all it does is bind
  Shift+Enter to `ESC CR` in iTerm2 and VS Code. A ThinkRail terminal *knows* when it is running that
  agent (the tab's detected `agent` kind), so it installs the same convention itself, scoped to those
  tabs: Shift+Enter sends `ESC CR` there and nothing anywhere else, so a plain shell never sees a
  meta-Enter it did not ask for. A negotiated protocol still wins — the convention is the fallback for
  programs that answer no question.
- **Terminal renderer + font measurement.** `TerminalInstance` runs xterm's **default DOM renderer** on
  purpose — `addon-webgl` is *not* loaded, and loading it would be a regression (see `architecture.md`
  Decision #11: the DOM renderer is a prerequisite for touch, and `WebglAddon.dispose()` leaks its WebGL2
  context, which our per-worktree terminal churn would hit). Addons are exactly `fit`, `clipboard`,
  `unicode11` and `web-fonts`; anything else pinned but unimported is dead weight and a trap for the next
  reader. `web-fonts` is load-bearing rather than cosmetic: our code font ships as per-alphabet woff2 subsets,
  so the Cyrillic/CJK file lands *after* xterm has measured the character cell (which it does once, at
  construction, and never again — unlike Monaco, which re-measures an untrusted early reading). Without the
  re-measure, non-Latin glyphs render into cells sized for the fallback font and the PTY holds the wrong
  cols/rows. Initial attach therefore waits for `relayout()`, performs a final `fit()`, and only then captures
  the PTY grid. The wait is **bounded by a deadline**, because `relayout()` in the pinned addon awaits
  `document.fonts.ready` plus a `FontFace.load()` per registered face — one stalled font response keeps it
  *pending* (not rejected) indefinitely, and an unbounded wait would leave the pane blank with no shell.
  Relayout failure or deadline expiry falls back to the construction-time measurement rather than stranding
  the pane; on expiry the stale relayout is neutralized first (disposing the addon skips its re-measuring
  `fontFamily` toggle), so a font that finishes loading late cannot re-lay-out an already-attached terminal.
  This ordering also prevents a fallback-width attach followed by a corrective resize from producing
  post-snapshot shell redraws that can erase replayed rows. Its pre-bind output buffer is a bounded waiting
  state: successful bind filters it to the adopted PTY, while creation failure clears it and stops accepting
  page-wide terminal frames. That failure renders the host's stable guidance as escaped DOM text rather than
  executable terminal output, with Terminal Settings and Retry actions. The failed xterm subtree is inert;
  an explicit retry keeps that recovery surface mounted and its actions disabled until the request settles,
  preserving focus without stealing unrelated workbench focus. Initial xterm focus is deferred until a
  successful attach and applies only while the terminal tab that requested it still owns focus; Retry keeps
  its overlay mounted through the successful handoff and restores xterm focus only while focus remains in that
  terminal region. A competing detach invalidates that handoff and clears its retry state before exposing Take
  Back again.
  **Historical replay is input-inert:** the PTY id
  remains unadopted until xterm's replay callback, which rechecks attach freshness before binding and draining
  genuinely live frames; replies xterm synthesizes for recorded terminal queries can therefore never enter the
  live shell. PTY sizing distinguishes desired, in-flight, and
  host-acknowledged grids; only a successful `terminal.resize` advances the acknowledgement, so reconnect
  replay cannot leave a full-screen app permanently sized to a request the host never applied. The 16 ANSI
  slots come from the theme's `--ansi-*` domain palette (never the semantic UI text tokens); on top of it
  xterm runs a **`minimumContrastRatio` legibility floor** driven by the theme's contrast metadata (normal
  `4.5`, high `7`, in `panels/terminalContrast.ts`). xterm's default of `1` disables correction, which
  left colours close to the terminal background (`black` on the near-black dark canvas) with no floor; the
  ratio lifts the resolved foreground against the live background without editing the palette — all 16 HC
  ANSI colours render ≥ 7:1 with hue preserved. The floor **cannot** fix ANSI **dim** (SGR 2): xterm renders
  dim as the foreground at 50% opacity, correction never fires for the already-high-contrast default
  foreground (Vite's `(client)` tag is dim over the *default foreground*, not an ansi colour), and 50%
  over a light canvas caps ≈ 3.3:1. So in **high-contrast themes the dim attribute is stripped from
  terminal output** (`stripAnsiDim`), rendering that text at full foreground contrast (≥ AA). The
  `terminalContrast.test.ts` gate reproduces xterm's colour maths to hold both HC themes at the threshold. The **12px
  content inset** lives on the xterm **mount host's own box** (absolutely positioned, `inset-12` on every
  side) rather than as padding on it — FitAddon derives cols/rows from that host's measured size, so
  padding would overcount the grid and clip the last row/column; insetting the box keeps the measured
  area equal to the visible content area. The instance is a **flex column**: the xterm frame is the
  growing child and the Claude facts strip (`terminal-agent-facts`) a `shrink-0` row under it that
  **wraps** (`flex-wrap`) — a narrow pane gets a second row of chips rather than chips clipped at the
  right edge, and the frame's height follows, so the fit stays exact. The plan popover anchors to the
  strip's top edge (`bottom-full`), which holds whatever the strip's height is.
- **IME control-chord rescue.** xterm 6.0.0 drops `Ctrl+<letter>` and `Escape` outright while a CJK
  input method is active (upstream #6065): its chord table switches on `keyCode`, and an active IME
  reports the sentinel 229 for every key, so nothing matches and *no byte is emitted* — a
  Chinese/Japanese/Korean user cannot interrupt a runaway process or leave vim. `TerminalInstance`'s
  key handler intercepts keydown at `keyCode === 229` and derives the control bytes from `event.code`
  (which stays accurate under an IME) via `imeControlBytes`, writing them to the PTY itself; anything
  that isn't a rescued chord is left to normal text input.
- Heavy deps (Monaco / shiki / xterm) load via `React.lazy(() => import())` to stay out of the eager bundle.
  A lazy chunk that fails to load (or a render throw) is contained by the `components/ErrorBoundary` the
  **shell** wraps each region in (see `shell/SPEC.md`), so a single panel degrades instead of blanking the
  app; panels themselves don't own the boundary.
- Streaming invariant (when chat lands): `text_delta`/`thinking_delta` **APPEND**;
  `tool_execution_update.partialResult` **REPLACE**.
