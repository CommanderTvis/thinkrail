---
id: submodule-web-plugins-registry
type: submodule-design
status: draft
title: plugins/registry — plugin contribution state
parent: submodule-web-plugins
depends-on: [module-plugin-api]
tags: [v1, plugins]
---

## Responsibility

The zustand store every plugin web-half contribution lands in (`usePluginRegistry`), plus the read
selectors the rest of the app consumes it through. Never mutated directly by a component or panel — only
`plugins/loader/context.ts` writes to it, on behalf of a plugin's `activate()`.

## Boundary

- **Owns:** `store.ts` (`usePluginRegistry`: `manifests`, `roster`, `active`, one append-only, pluginId-tagged
  array per contribution kind — `sideTools`, `settingsSections`, `companions`, `fileViewers`,
  `tabDecorators`, `launchers`, `workspaceActions`, `projectActions`, `terminalAccessories`,
  `toolRenderers` — plus `slots` keyed by the three `CoreSlots` names; `workspaceActions` and
  `projectActions` are separate tables (not one table split by a `scope` field) so their selectors keep
  handing back a stably-typed `Entry<WorkspaceScopedActionRegistration>[]` /
  `Entry<ProjectScopedActionRegistration>[]` — a project action's component takes `{ projectId }`, a
  workspace action's takes `{ workspaceId, groupId }`, and a caller that read one array as the other
  would call a component with the wrong props; `removePlugin(id)` drops every row tagged with that id,
  across every table, in one write) and its selectors (`selectToolCatalog`, `selectSideTool`,
  `selectSettingsSections`, `selectCompanions`, `selectFileViewer`, `selectTabDecorators`,
  `selectLaunchers`, `selectWorkspaceActions`, `selectProjectActions`, `selectTerminalAccessories`,
  `selectSlot`); `icons.ts` (`pluginIcon(name,
  active?, assetBase?)` — a curated Remix Icon lookup by manifest icon name, `active` picking the `Fill`
  variant where the map has one; `asset:<path>` draws that SVG from the plugin's assets through the kit's
  `SvgAsset`, one memoized component per URL so the catalog stays referentially stable, with `assetBase`
  from `pluginAssetBase(entry, httpBase)` — the same base `ctx.assetUrl` builds on; everything unknown, and
  an asset name on a plugin that declares no assets, falls back to `RiPuzzle2Line`). The loader hands
  `setRoster` the transport's `httpBase` with each roster, since this module may not reach `transport`.
- **Public surface (barrel):** `usePluginRegistry`, every selector above, `pluginIcon`, `pluginAssetBase`, and the
  `LayoutToolCatalogEntry` / `FileViewerEntry` / `ResolvedFileViewer` types.
- **Allowed deps:** `@thinkrail/plugin-api` (types) + `@thinkrail/contracts` (types) + `zustand` + `react`
  (types) + `@remixicon/react` + `@thinkrail/plugin-ui` (`SvgAsset`).
- **Forbidden:** `store`, `transport`, `panels`, `shell`, `chat` — this module never initiates a live effect;
  it only remembers what `loader` told it.

## Get right

- Every contribution table is an **append-only array tagged with the registering plugin's id**, not a
  `Record<id, T[]>` per kind — `removePlugin` needs one `filter` per table regardless of shape, and the flat
  array is what makes "registration order, first eligible wins" (file viewers, tab decorators, slots) fall
  out for free instead of needing a second ordering index.
- `selectToolCatalog` reads `roster[].contributes.sideTools`, **not** the `sideTools` runtime-registration
  table — a dormant plugin's tool tab must render (as a placeholder) even though its web module never called
  `sideTool()`. `selectSideTool(tool)` is the other lookup, over the runtime table, for the mounted
  component a non-dormant tab actually renders.
- `slots`' three arrays are typed `Entry<SlotResolver>[]` (`SlotResolver = NonNullable<CoreSlots[keyof
  CoreSlots]>`, a deliberately widened union) so one `addSlot`/`removePlugin` implementation covers all
  three; `selectSlot<K>` narrows back with one local cast at the read site — the alternative (a
  `Record`-of-three-distinct-array-types) forces three copies of every table operation for no caller-visible
  gain.

### Referential stability

`usePluginRegistry` is a plain zustand `useStore`/`useSyncExternalStore` hook: it re-renders whenever a
selector's return value fails `Object.is` against the previous one, so **every selector must return either
a reference already sitting in state or one derived at write time — never an array or object built fresh
inside the selector itself.** A selector that does `.map`/`.filter`/spreads a fresh `{ ...value, pluginId }`
on every call hands back a new reference on every render even when nothing changed, which loops forever
under `useSyncExternalStore` (this is what broke the browser e2e suite at page load once every list selector
did this). Two shapes satisfy the rule:
- **A contribution table is already a stable, append-only `Entry<T>[]`.** A selector that just reads the
  table (`selectSettingsSections`, `selectWorkspaceActions`, `selectTerminalAccessories`,
  `selectTabDecorators`) returns it as-is — callers read `entry.value`/`entry.pluginId` instead of a
  selector-side spread.
- **A selector that must combine tables, filter, or reshape into a different public type** (the tool
  catalog crosses `roster` × `active`; `selectCompanions` filters by host kind; `selectSlot`/`useLaunchers`
  must hand back bare values with no `pluginId`) gets its result **computed once inside the write action**
  that can change it and stored (`toolCatalog`, `companionsByHost`, `slotResolvers`, `launcherList`) —
  selecting it is then a plain property read. `selectSideTool`/`selectFileViewer` stay computed per call
  since they `.find()` a stored object (or return `null`) rather than building a new one.

The same rule applies one level up: `loader/context.ts`'s `useHost` builds a `HostProjection` from several
independent `useAppStore` slices — each slice is its own selector (so an unrelated store write can't touch
it) and the projection object itself is `useMemo`'d over those slices, so a plugin selecting
`host.activeEditor` or the whole projection doesn't loop either.
