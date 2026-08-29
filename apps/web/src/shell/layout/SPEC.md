---
id: submodule-web-shell-layout
type: submodule-design
status: active
title: shell/layout — frontend-local workbench frame
parent: submodule-web-shell
depends-on: [module-contracts]
tags: [ui, layout, tabs, drag-and-drop]
---

## Responsibility

The shell-owned, headless workbench engine: the normalized frontend-local frame and per-workspace view grammar; legal atomic mutations and projection; recursive center plus left/right/bottom rendering; resize/alignment and drag geometry; keyboard arrangement commands; and focus recovery. It renders containers; feature views remain arrangement-agnostic.

## Boundary

- **Owns:** web-local `WorkbenchFrame`/`WorkspaceViewState` types; frame-plus-view projection; pure topology, placement, attention, and policy operations; semantic minimum and independent group-limit checks; one-result drag previews; center/side/bottom renderers; alignment-owned nested composition and side-width projection; tab-strip overflow; ARIA tab/separator behavior; and the terminal visibility gate.
- **Public surface (`index.ts`):** all current-layout types; workbench renderer/controller; pure mutations, projection, and validation helpers; built-in preset definitions plus instantiate/apply/capture operations; attention fallback helpers; and unavailable-reason results. Callers inject resource renderers and commit complete pure results rather than splicing arrays.
- **External deps:** `@thinkrail/contracts` for the resource-free custom-preset DTO and git diff-scope type only; shell-neutral `lib` attention/id primitives; React; `react-resizable-panels`; `@dnd-kit/core`.
- **Forbidden:** server/shared/pi imports; domain-resource lifetime; browser persistence or WS calls; feature-panel internals; a mutable third-party docking model; inline component styles; or non-semantic colour values.

## State contract

One `WorkbenchFrame` belongs to a frontend surface, not a workspace. It carries stable group/split ids, center topology, left/right/bottom groups and geometry, auxiliary visibility/folds, bottom alignment, singleton-tool placement/order, and restore targets. It carries no workspace resource identity, preview, selected tab, navigation clock, pointer draft, or viewport compression.

A `WorkspaceViewState` is keyed by workspace and references frame group ids. It carries
file/diff/chat/document/terminal membership and order plus center preview identity. The separate
`LayoutAttention` overlay carries selection per group, last focus for center/each auxiliary region, and
per-group navigation clocks. The mounted workbench document is a pure projection of the singular frame,
active workspace view, and its attention; it is never stored as another authority.

Pure operations return either one complete local-state result or an unavailable reason. A resource-only
command patches the active workspace view. A frame command returns the frame plus every required
retained-workspace remap; the store installs that result atomically through
[[submodule-web-shell-layout-state]]. Components never splice groups or tabs. Stable ids are placement keys;
a tab's `name` remains non-identity metadata. Singleton tool names resolve from the current web-owned catalog
at presentation time, so copy updates never rewrite local layout state.

A click that may become a browser `dblclick` waits the shared 250 ms settle window. The upgraded gesture emits
only its final keep while retaining the leading preview-slot claim, whether content was cached or required a
host read. It never persists an intermediate preview. Pointer/resize drafts and viewport compression remain
runtime-only.

Frame groups may remain empty in any workspace. Closing a final resource therefore leaves topology untouched. Explicit remove/merge is the only way to delete a group, and its result rehomes every resource that references it across all locally retained workspace views. At least one center leaf always remains.

## Layout grammar

- **Center:** a recursive horizontal/vertical binary tree, maximum four leaves. A split replaces one leaf with equal halves. User creation/resize requires each child to remain at least 320 px wide and 180 px high. Empty leaves are valid frame slots and render the shell-provided empty surface. Remove/Merge promotes a sibling and rehomes every affected workspace's tabs deterministically.
- **A tool the workspace cannot serve is not offered.** `Workbench` takes `unofferedTools`, and every
  reveal menu — the side group's and the tab context menu's — leaves those out, so nothing in the shell can
  open one. The engine stays ignorant of *why*: the shell decides, this module only withholds. It reaches
  the two menus through a context rather than a prop threaded across every group view; both read it where
  the list is built, and nothing else needs it. Withholding never touches the document: a tool already
  placed keeps its tab (its renderer explains itself, as the Claude pane does when the integration is off),
  and the condition can clear without a saved layout having been rewritten behind the user.
- **Auxiliary eligibility:** Projects, Specs, Files, Changes, and Review are singleton auxiliary-only tools owned by the frame; terminals are workspace resources and may occupy center or any auxiliary region. Hiding a singleton preserves its restore target. View/deep-link reveal restores or unfolds it in frame-local position and focuses the requested item in current workspace attention.
- **Left/right:** ordered vertical frame stacks. Dragging an outer separator through its minimum hides that side, retains the last expanded width, and exposes its full-height restore rail. Broad upper/lower targets create groups before/after each row, including folded or currently empty rows. Expanded bodies have a 120 px normal minimum; folded groups occupy 27 px and retain normalized expanded weights. An empty frame group remains available across workspaces until explicit removal and renders a named
  Add/Reveal surface rather than disappearing; a region with groups may stay hidden.
- **Bottom:** ordered left-to-right frame groups resize on vertical separators. A group may fold to a 27 px
  vertical rail. When the region is hidden or the frame has no bottom groups, the workbench renders no bottom
  chrome and reserves no bottom height; there is no persistent restore rail. While a bottom-eligible tab is
  dragged and the bottom is not rendered, a 24 px-high horizontal Primary drop zone appears over the span
  selected by bottom alignment; dropping there reveals the region. With no drag active, `Mod+Shift+J` remains
  the direct chrome-free restore path. Height starts at 30%, has a 120 px body minimum, and caps at 70%.
  Alignment is center, center+left, center+right, or full workbench. A side excluded from that span owns its
  lower corner and continues to the workbench bottom; an included side ends above it; the drag-time drop zone
  follows the same ownership. Alignment follows actual browser-local side projection during resize and narrow
  compression while persisted workbench-wide frame ratios remain the target and are converted through nested
  panel groups. A separator gesture commits only the ratio of the side that owns it; compression of an
  untouched neighbor remains runtime-local. Hidden sides contribute no phantom width. A visible empty bottom
  frame slot remains available across workspaces until explicit removal and renders terminal creation/reveal
  affordances.
- **Limits:** left/right share a local setting defaulting to six groups per side; bottom has an independent local setting defaulting to three. Both accept 1–32, with closed hard safety bounds enforced even for untrusted local state or shared presets. Existing overages survive; creation is unavailable until below the configured limit, while reorder/join/reducing moves remain legal. Stable-id uniqueness, one canonical resource placement per workspace view, normalized geometry, and the final-center-leaf invariant are enforced by every mutation.
- **Small viewports:** restoring onto less space may compress below operation minimums locally. Content scrolls/clips; bottom alignment projects from actual compressed side spans, while frame topology, alignment choice, and ratios are never rewritten merely because this viewport is narrow.

Ordinary opens target the active workspace's last-focused surviving center group. Reopening a canonical resource selects its existing local placement rather than duplicating it and refreshes non-identity metadata in place. Each center group has one workspace-local preview slot: preview replaces in place, keep promotes one-way, and navigation clocks are group-local. A passive restore may select its first result without incrementing the user-navigation clock. A user open advances its clock at request time and carries that stamp through acceptance rather than counting twice; reselecting the active center tab also advances once so it defeats older deferred work. Incidental DOM focus changes update last-focus routing but not navigation.

Async completion reroutes from a removed group to current last focus and advances the surviving destination once, unless newer local placement already contains the resource. File/chat/document closes update local attention immediately. Terminal close waits for host-domain acceptance, then removes that terminal from every local workspace view for the workspace; a rejection leaves placement and attention untouched. Any newer tab gesture or navigation suppresses delayed close-focus recovery.

## Arrangement and accessibility

A tab drag paints exactly one result: strip insertion, whole-group join, legal center half-split, side
upper/lower boundary, or bottom left/right boundary. Expanded strips remain join/reorder targets while bodies
create adjacent groups; folded rails divide their compact axis between the same two targets. The user never
has to acquire a thin outer edge. Hidden left/right restore rails are broad legal creation targets within local
limits. When bottom is not rendered, its drag-time zone reuses the active workspace's last-focused surviving
bottom frame group, falls back to the trailing group, or creates one at the trailing boundary only when no
group exists and the local bottom limit permits; either drop reveals the region. Illegal domains, limits,
exact-position no-ops, and minimum violations paint no target and commit nothing. Escape, pointer
cancellation, outside drop, or a superseding local frame/view transition restores the source. A drag moves one
workspace resource or one frame-owned tool; it never copies or crosses workspaces.

Drop-target styling has no resting treatment. As soon as a movable tab is picked up, every currently valid
destination shows a subtle Primary hint, and the destination under the pointer strengthens. Both states derive
from the existing drag state and each site's already-computed validity—there is no second drag-state
machine—and use only semantic Primary roles, never `feedback-*`: `drop-hint` is a subtle Primary outline or
translucent surface and `drop-active` is stronger. Tab-header targets outline the whole group header;
individual before/after insertion markers remain the precise hover cue. Center-split targets show compact
directional edge hints at drag start and fill the true resulting half on hover. The bottom drag-time zone is
24 px high and takes collision priority within that band over overlapping lower-body targets. Active emphasis
clears on pointer leave; all hints clear on drop or cancel; decorative layers never alter hit-testing or the
committed result.

Creating or deleting a group is visibly a frame command and therefore affects every workspace in this window. Moving a resource among existing groups affects only its workspace view. Moving a singleton tool changes frame placement globally within this window. Uncommitted drag/resize drafts stay runtime-local and commit once on drop/pointer-up; no host revision can cancel them. A local projection epoch invalidates drafts or delayed preview-settle timers only when another local transition replaces their base. The canceled-drag announcement is reserved for a pointer or keyboard separator gesture that is in progress when its base is replaced: `react-resizable-panels` reports layout on every group mount and ordinary resize, so a group that merely lived through earlier local transitions announces nothing.

Pointer is never the sole arrangement path. Keyboard controls and shadcn menus cover group/tab focus, select/close/keep/reorder/move, directional center splits, absolute and adjacent auxiliary-group creation, explicit group remove/merge, fold/show/hide/tool restore, bottom alignment, and keyboard separator resize, always with an unavailable reason. A tab can reproduce every interior pointer placement through move plus New group. Tab strips implement WAI-ARIA tabs and visible roving focus. A folded auxiliary group retains its linked native-hidden tabpanel while unmounting the body; its restore control is the focus endpoint when no tab renders. A local fold moves focus to that control and expansion returns it to the selected tab. Separators expose orientation and current/min/max values. `Ctrl+F6` visits upper-row groups in visual order, then visible bottom groups left-to-right.

One-row strips have bounded readable tab widths and no fixed previous/next controls: wheel, trackpad, touch,
roving-keyboard navigation, active reveal, and the searchable keyboard overflow list scroll the same list.
Native scrollbars stay hidden; pointer-transparent edge fades appear only where clipped and update without
changing the fixed 32 px strip. Full-height strip actions share that width. A control renders only when it can
act: overflow search only while clipped, and fold only while a side has multiple groups or is already folded.
Singleton tool tabs have no inline close glyph; Close/Hide stays in their menu and on Delete, while terminals
and center resources retain their direct control.

Each auxiliary strip trails an add-to-this-group menu. It offers shell-injected actions plus unplaced tools valid for that region; two rails never offer the same singleton. Center tab menus offer no singleton tools. A terminal created from an auxiliary group lands in that workspace's matching group; a vanished target reroutes through the current local focus rule.

### Keeping terminals alive across a switch

A centre group renders only the selected tab's body, which for a terminal meant tearing down xterm and its
addons on the way out and rebuilding them on the way back — re-attaching and replaying the whole scrollback
to arrive at the screen the user had just been looking at. That teardown/rebuild, not rendering, was the
dominant cost of switching tabs. The **`KEPT_TERMINALS` most recently selected terminals stay mounted**,
stacked in the panel with the inactive ones `invisible`. The bound matters (a workspace can hold dozens of
terminals), and so does `invisible` over `hidden`: a terminal measured at zero size re-fits to a degenerate
grid and loses its wrap, so an inactive one must keep occupying real layout space. Only terminals are kept
— they are the stateful, expensive-to-rebuild body; every other kind still mounts on demand.

### Tab panes (grouping)

Two tabs of one group can be shown **together** as resizable panes instead of one at a time. Reached two
ways in the vertical strip: dropping a tab on the band between another tab's insertion edges (left half
side by side, right half stacked), or that tab's context menu, which offers its immediate neighbours —
a flat "show beside …" list of twenty terminals is a menu nobody reads, and dragging covers arbitrary
pairings. Members carry a left accent so the pairing is visible in the list.

Rows are taller in this strip than in a horizontal one, and the insertion edges take a quarter each: three
targets on a ~30px row is a lottery, and the grouping band is the one in the middle.

Direction is chosen on drop and changeable afterwards from the context menu ("stack this group" / "put
this group in columns") — a drop lands in one of two halves and being stuck with a guess is not a layout.

**Which arrangement a *new* pane gets is a setting** (`defaultPaneDirection`, a local layout preference
under Settings → Layout: columns or rows), because the answer is a habit rather than a per-pair decision —
and both roads into a pane honour it. The context menu names it ("Show beside …" / "Show under …") so the
menu never promises one thing and does another, and the drop band is **one** target whose label says the
same. It used to be two halves, beside on the left and under on the right — an explicit gesture in theory,
a lottery in practice: nothing marked the boundary mid-drag, so half of all drops landed the arrangement
the setting had ruled out. Changing an arrangement afterwards is the pane's menu ("Stack this group" /
"Put this group in columns").

**A pane never offers a drop to a tab it already holds.** The join band exists to bring a newcomer in;
for a member it could only re-add what is there, so over a fellow member the band does not paint and the
insertion edges — the leave-the-pane gesture — are all a drag can mean.

**Joining an existing pane joins its arrangement.** The two halves and their two directions are offered
only over a tab that is still on its own; over a member, the whole band is one target that says which
arrangement the newcomer is joining, and `groupTabs` keeps the pane's own direction whatever a caller
asks for. Two columns plus one is three columns: a third member arriving used to flip the pane to
whatever the drop said, which reads as the split forgetting itself, and re-drawing a pane is what
`setPaneDirection` is for. The members already there keep their proportions to each other too — the
newcomer takes an equal share, the rest are scaled into what is left, rather than everyone being reset
to even.

**A preview opened over a member replaces that member inside the pane.** The preview slot is a tab like
any other and can be a pane's; when it was, opening the next file dropped the old id from the pane,
which then fell below two members and dissolved — clicking a file in the tree made a split vanish. The
newcomer now takes its place in `tabIds`, so the split survives with a new file in that column.

**A pane's members are one contiguous run of `group.tabs`.** They draw as one entry with a shared accent,
so an unrelated tab sitting between them reads as two broken entries rather than one — and both grouping
and an in-group drag used to allow exactly that, since neither reordered the strip. Grouping now pulls
the members together, anchored where the pane's first member already sat and in `tabIds` order (the order
the panes and their weights render in), and every rebuild re-establishes it. An *unrelated* tab dropped
between members is therefore pulled to one side of the block rather than splitting it.

**Where a member's drag lands decides what it means.** A drop inside its own pane's run — on a fellow
member's edge — reorders the pane: the strip order and the split order are one order, so moving the row
moves the column, and weights travel with their member. A drop past the run takes the member out; a pane
below two members dissolves, which is how a pair is broken up by hand. It used to be refused as a no-op
either way, so neither reordering nor leaving was possible by drag at all. The tab's own menu carries the
same two verbs for the keyboard: "Move left/up in this group" (`reorderPaneMember`) and "Show on its own".

Panes ride the **workspace view**, not the frame (`WorkspaceGroupView.panes`): their members are workspace
tabs, and carrying them on the frame would have let a resize or a side-fold — any frame round-trip —
rebuild the centre without them, silently dissolving every pane.

Selecting any member shows the whole pane, so a pane is one entry in the strip without being one row.
The divider is the same `ResizablePanelGroup` every other region uses, and it commits through the same
gesture accumulator every other resize does — writing straight from `onLayout` would persist a document per
frame of the drag, with no way to abandon the gesture — landing its weights through `setPaneWeights`. Terminals in the active pane leave the keep-alive stack, which assumes one visible at
a time, and render inside their pane box instead.

**The mode never flips.** With vertical tabs on, the centre cannot be split: the drag zones are gone and
the Split items leave the context menu — a verb the mode removed is hidden, where a verb a *limit* blocks
stays disabled with its reason, because only the second is something the user can do anything about. A split would give each half its own horizontal strip, which is precisely the
layout the setting exists to replace. A split that already existed keeps its vertical strips — one per
group — rather than falling back to horizontal, because falling back would flip the layout out from
under the setting; it is a state the user is leaving, not one they can enter.

**Making a pane is a vertical-strip gesture; an existing pane renders in either orientation.** The drop
band and the "show beside" neighbours appear only in the vertical strip, but a pane that already exists —
dragged together there, or made by intent, as the blueprint pair is — keeps rendering its members together
when the setting is off: turning vertical tabs off must not quietly unsplit a layout the user (or the
blueprint flow) deliberately paired. The horizontal strip lists members as ordinary tabs, selecting any
member shows the pane, and the in-pane management verbs (reorder, stack/columns, "Show on its own") stay
in the tab menu in both orientations. That creation/render split is what makes panes group metadata
rather than a node in the center tree.

### Vertical center tabs

Center tabs optionally render as a column beside the editor instead of a strip above it, toggled by the
local `verticalCenterTabs` layout preference. It applies **only when the centre is a single group**: a split
would put two columns side by side and leave neither editor enough width, so a split keeps the strip
regardless of the setting. The column is drag-resizable through the same `ResizablePanelGroup` every other
region uses; that group speaks percentages while the preference stores **px** (`verticalCenterTabsWidth`,
clamped on hydration), so the column keeps its chosen size when the window resizes rather than scaling with
it. Dragging emits a width per frame and only the resting value is persisted.

The column earns its width by disambiguating: a basename shared by two open tabs gets a second, dimmed line
naming its folder, and only then — a folder on every row is noise, and the horizontal strip has no room for
one at all. Orientation also flips what the tab chrome means: the active marker moves from a bottom rule to
a left one, insertion targets from left/right halves to top/bottom, and the horizontal scroll affordances
give way to ordinary vertical scrolling.

**Where a tab can go is a picture, not a list of sentences.** The context menu draws the workbench —
side columns, the editor, the bottom strip — with a cell for every existing group and a `+` slot in every
gap, including the ends (`GroupPlacement.tsx`). A cell moves the tab into that group; a slot makes a new
one at that index. It replaced eleven-odd rows that each spelled out one edge ("New left group at top",
"Move to bottom group db90") and still could not say what the layout looked like or which group the tab
was already in — the picture says both. Cells are named by **where they are** ("Left", "Right 2", "Main
column", "Bottom"), not by what is open in them: a session title in a 60px box wraps to three lines of
nothing, and the position is the part that does not change while you read the menu. What a group holds is
in its tooltip, which is where "which one is that?" belongs. Regions this kind of tab cannot enter are drawn as dashed outlines rather than
offered: a tool has no business in the centre, and a file none in a side rail.

Every cell is still a `ContextMenuItem`, so the keyboard, the roving focus and a screen reader read exactly
the list it replaced — each carries the sentence as its accessible name, and an unavailable one keeps its
reason in the tooltip where a picture cannot spell it out.

**An action that is only "already done" is not shown at all.** Keep preview on a kept tab, Move left on
the first tab, Show on its own outside a pane, Focus next group with no other group — a row saying
"already first" is a row that will never do anything, and six of them ahead of the ones that will is how
a menu stops being read. A *limit* still shows and says so (the placement picture's disabled slots keep
their reason in a tooltip): "you cannot have a fourth bottom group" teaches something, "you are where you
are" does not.

Pointer is never the sole arrangement path. Keyboard controls and the shadcn menu surface cover group/tab
focus, select/close/keep/reorder/move, directional center splits, absolute and adjacent auxiliary-group
creation, fold/show/hide/tool restore, bottom alignment, and keyboard separator resize, always with an
unavailable reason. A tab can reproduce any interior pointer placement from the placement picture. Tab strips implement the WAI-ARIA tabs pattern and visible
roving focus; a folded auxiliary group retains its linked native-hidden tabpanel while unmounting the body,
and its named restore control is the group focus endpoint when no tab control is rendered. A local bottom-fold
transition moves focus onto that restore control and expansion returns it to the selected tab. Separators expose
orientation and current/min/max values. `Ctrl+F6` visits upper-row groups in visual
order, then visible bottom groups left-to-right. One-row strips have bounded readable tab widths and no
fixed previous/next controls: wheel, trackpad, touch, roving-keyboard navigation, active reveal, and the
searchable keyboard overflow list all scroll the same tab list. Its native scrollbar stays hidden; subtle,
pointer-transparent edge fades appear only on directions with clipped tabs and update with scroll, resize, and
tab changes without altering the fixed 32 px strip or tab geometry. Full-height strip actions share that 32 px
width, keeping search, creation, alignment, and fold controls square. A strip control renders only when it
can act: the searchable overflow list while the tab list overflows its scroller, the fold button while the
side holds more than one group (or the group is already folded) — folding a lone group buys no space from a
neighbour. Singleton tool tabs
(Projects, Specs, Files, Changes, Review) carry no inline close glyph; Close remains in their context menu
and on the Delete key, while terminals and center resources retain the direct glyph.

## Presets and local persistence

Balanced, Focus, and Review are web-owned resource-free frame definitions with a below-center bottom slot:
Balanced and Review show it; Focus hides it. Balanced and Focus start with one center group; Review provides
its deliberate vertical pair. Custom presets use the same grammar and capture geometry,
topology, tools, folds, and empty structural slots, never workspace resources or terminal count. Preset node
ids are template-local labels: instantiation mints frontend-local frame ids and returns the old→new group map
used to rehome every workspace view. Only custom definitions cross the wire through settings.

Applying a preset creates one replacement frame, raises this surface's local side/bottom limits if required, and remaps all retained workspace views atomically. Center resources preserve visual order and distribute across destination leaves; terminals map into compatible slots; singleton tool placement ids survive where possible. Omitted tools receive deterministic restore targets, so a sparse preset cannot strand Projects or another tool. The local default preset is the target of the explicit Reset frame command; ordinary workspace switches retain the current frame. Default selection and limits persist locally, not in host settings.

`layoutState` validates and persists the normalized frame/views/attention document under endpoint + frontend-surface identity. Reload and supported session restoration reuse it; simultaneous windows never consume each other's storage events. Persistence contains references only. Failure leaves live state intact; unknown schema falls back to the Balanced safe frame.

The complete current-layout grammar, including the derived `WorkspaceLayoutDocument` projection consumed by existing shell renderers, is web-local. A pristine surface instantiates Balanced; no host snapshot or prior layout schema is imported.

The terminal visibility gate mounts a body only for a terminal locally selected in an unfolded visible group. Distinct terminal identities may mount concurrently; one identity has one body per browser surface. Inactive/folded/hidden tabs never attach. Global New Terminal targets last local bottom focus, creating a frame slot only through an explicit frame command; center Group Header creation captures that group. Host catalog reconciliation may place an unrepresented terminal locally without selecting it, but cannot change frame geometry.
