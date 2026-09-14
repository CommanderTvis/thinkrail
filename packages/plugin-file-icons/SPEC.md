---
id: module-plugin-file-icons
type: module-design
status: active
title: plugin-file-icons — file-type glyphs as a web-only builtin plugin
parent: module-plugin-api
depends-on: [module-plugin-api, module-contracts, module-plugin-ui]
references: [module-web]
tags: [v1, plugins]
---

## Responsibility

Draws the glyph a file wears by type — `.kt`, `Dockerfile`, `vitest.config.ts`, and a few thousand
more — occupying the `fileIcon` core slot (W17). Owns `web/fileIcon.ts` (`fileIconName`, the pure
filename/extension lookup and its test), `web/fileIcons.generated.ts` (the committed mapping), and
`scripts/generate-file-icons.ts` (the generator, moved here from `apps/web`). The
`material-icon-theme` dependency and its exact version pin moved here from `apps/web`.

## Web only, no host half

The manifest declares no `host` — like `plugin-pdf-preview`, this plugin needs no server-side
behaviour beyond serving its own static assets, which `packages/server/src/plugins/SPEC.md`'s builtin
asset-serving note covers generically for every manifest-only builtin.

## Assets, not bundled imports

Unlike a plugin that ships a handful of small SVGs as source, this set is 1251 files (~5 MB) — build
output, not something to bundle or review. The manifest declares `assets: "assets"`; the generator
writes the recoloured SVGs to `assets/file-icons/*.svg` (gitignored by the package's own `.gitignore`)
and the filename/extension mapping to the committed `web/fileIcons.generated.ts`. `web/index.ts`
resolves a path to an icon name via `fileIconName`, then builds the file's URL with
`ctx.assetUrl(\`file-icons/${name}.svg\`)` (W19) and renders it with the kit's `SvgAsset`
(`@thinkrail/plugin-ui`) — a fetch-once-per-URL inline-SVG primitive shared with the Claude Code
plugin's own brand-mark glyph. An asset the host cannot serve (a mismatched or broken build) draws the
same plain Remix file glyph core falls back to, never an empty slot.

- **Recoloured at build time, not at runtime.** The generator rewrites every icon's fills to
  `currentColor`. Material's icons are one or two flat colours — a saturated primary and a pale
  accent — so the paler half keeps its own reading as reduced alpha (`fill-opacity=".45"`, 732 of the
  1251), and one asset then serves every theme instead of a light set and a dark set. The 22 gradient
  icons flatten to the primary: a gradient has no two halves to split, and a Kotlin lozenge is still a
  Kotlin lozenge in silhouette.
- **Whole filenames beat extensions, longer extensions beat shorter** (`fileIcon.ts`): `package.json`
  is Node's icon, not JSON's; `api.d.ts` is a declaration file, not TypeScript. Anything unrecognised
  gets the plain file glyph, which core's own Remix fallback (`FileTypeIcon`, `apps/web/src/components`)
  never has to draw itself, since this plugin already names one (`FILE_ICON_FALLBACK`).
- **Directories return `null`.** The slot resolver only claims `kind === "file"`; a directory row falls
  through to core's Remix folder glyph, since material-icon-theme's own folder set is out of scope here.

## Build wiring

`"build": "bun scripts/generate-file-icons.ts"` is what turbo's `^build` runs before `@thinkrail/web`'s
own `dev`/`build` task, now that `apps/web` depends on this package like every other builtin — the app
no longer runs `icons:generate`/`icons:check` itself. `icons:generate`/`icons:check` stay as this
package's own scripts for a developer regenerating the set by hand after a `material-icon-theme` bump.

## Boundary

- **Public surface (`./web`):** the default-exported `PluginWebModule` only — `fileIconName` and the
  generated tables are internal to this plugin's own slot resolver, not imported elsewhere. `core`'s
  `pluginIcon("claude")` (`apps/web/src/plugins/registry/icons.ts`) resolves the same glyph
  independently, through the `fileIcon` slot with path `"CLAUDE.md"`, never by importing this package.
- **Allowed deps:** `@thinkrail/plugin-api`, `@thinkrail/contracts` (types), `@thinkrail/plugin-ui`
  (`SvgAsset`).
- **Forbidden:** `apps/web` internals — nothing here reaches `apps/web/src/components` or any other
  panel-owned module; a plugin's web half reaches the host only through `PluginWebContext`.

## Tests

`web/fileIcon.test.ts` pins `fileIconName`'s whole-filename-over-extension and longest-extension-wins
rules (moved verbatim from `apps/web/src/components/fileIcon.test.ts`). The generator itself has no
unit test — its correctness is what `icons:check` and the generated output being committed already
verify — and `e2e/plugins/file-icons/file-icons.spec.ts` drives the real slot end to end, including the
disabled-plugin fallback to core's Remix glyph.

**One component per icon name.** The slot resolver hands core a component, and core renders it as an
element: a fresh arrow function per call is a new element type on every render, so React unmounted and
remounted the glyph, and `SvgAsset` fetched and re-inserted the SVG each time. Resizing a column re-renders
every tab row per frame, which made the icons flicker. `createFileIconResolver` therefore keeps a map from
icon name to component and answers the same identity for the same name; a test pins that two paths sharing
an icon get one component and different icons get different ones.
