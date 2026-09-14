---
id: module-plugin-pdf-preview
type: module-design
status: active
title: plugin-pdf-preview — PDF viewing as a web-only builtin plugin
parent: module-plugin-api
depends-on: [module-plugin-api, module-contracts, module-plugin-ui]
references: [module-web]
tags: [v1, plugins]
---

## Responsibility

Renders `.pdf` files opened from the Files tree. Owns `web/PdfPreview.tsx` (the pdf.js-backed page
renderer, pinch/wheel zoom, selectable text layer, reload-from-disk), `web/pdfEngine.ts` (the pdf.js
loading-task wrapper), and `web/pdfTextLayer.css` (pdf.js's text-layer geometry contract, imported
directly by `web/index.ts` so Vite bundles it — a builtin plugin has no separate `styles` route). The
`pdfjs-dist` dependency and its exact version pin moved here from `apps/web`.

## Web only, no host half

The manifest declares no `host` — this plugin has no server-side behaviour: it reads bytes over the
worktree's existing `/files/…` route (`ctx.fileUrl`) and needs no method, channel, or settings
namespace. `packages/server/src/plugins/registry.ts`'s `registerBuiltinManifest` and
`activation.ts`'s `activate()` are what make a host-less builtin representable at all: a builtin entry
with a manifest but no `PluginHostModule` goes straight to `"active"` with no activation tables, and
`deactivate()` already no-ops when an entry never got tables — see `plugins/SPEC.md`. Before this
plugin, every builtin shipped a host half; a builtin manifest with no module was refused outright.

`web/index.ts` registers one `contributes.fileViewers` viewer for `.pdf` (`extensions: ["pdf"], read:
"none"`) via `ctx.fileViewer({ component })`. Registration needs no `matches` predicate — the manifest's
declared extension is already enough for `selectFileViewer` (`apps/web/src/plugins/registry/store.ts`)
to route `.pdf` opens here. The viewer builds its URL through `ctx.fileUrl(workspaceId, path)` and reads
the byte revision straight off `FileViewerProps.revision` (the loader already derives this from
`FilePane`'s `byteRevision`, so the component needs neither `ctx.useFileRevision` nor
`ctx.watchWorkspace`). Zoom clamping/gesture math (`clampZoomScale`, `isZoomGesture`,
`zoomScaleForWheel`, `ZOOM_SCALE_STEP`) comes from the kit's existing `@thinkrail/plugin-ui/visualization`
subpath — added there for the visualization companion, reused here rather than duplicated.

**When this plugin is off, `.pdf` opens as Monaco text** — the file-open dispatcher's ordinary
fallthrough once no registered viewer claims the extension. This is the intended dormant behaviour,
not a bug: a `.pdf`'s bytes are still readable as raw text by whoever wants that.

A `?t={byteRevision}.{reloads}` query param on the fetched URL is what makes the viewer track the file:
`FileViewerProps.revision` is the file's own byte tick, not the workspace's `loadedTick` (which advances
for a write anywhere in the worktree) — a LaTeX build writes `.aux`/`.log`/`.fdb_latexmk` and a dozen
other files beside the PDF, and reacting to `loadedTick` would re-fetch and re-rasterize a document that
had not changed. `reloads` is the toolbar's Reload from disk button, for a read no watch reported.

pdf.js is used directly (rather than a native `<iframe>`) because an iframe's own document never
surfaces the macOS pinch gesture (a `wheel` event with `ctrlKey` set) to this page — there is no seam to
hook it from outside. Each page is re-rasterized per scale at device pixel ratio, cancelling any render
still in flight (`RenderTask.cancel()`) rather than awaiting it, since a pinch emits scales faster than a
page rasterizes. `renderTextLayer` overlays pdf.js's own `TextLayer` at the CSS scale so the rasterized
page's text stays selectable; its geometry comes from three custom properties pdf.js writes per span,
which `pdfTextLayer.css` consumes — a pdf.js upgrade that renames them breaks selection silently, which
is why the e2e selects real text rather than counting spans. The live scale is presented by stretching
the already-rasterized pixels (`scale(live / rasterized)`) and pages are redrawn sharp once the scale
holds still for `PDF_RASTER_SETTLE_MS`, so a continuous pinch never asks for a render per wheel event.
The worker is loaded from an emitted asset (`pdfjs-dist/build/pdf.worker.min.mjs?url`) rather than a bare
specifier, since the desktop app serves the built bundle from disk where an unresolved specifier fails
silently.

## What stayed in core

`isImagePath`/`ImagePreview` and `coreViewers.ts`'s image registration are unrelated to this move and
stay in `apps/web` exactly as they were. `isPdfPath` had no caller left once `coreViewers.ts`'s pdf
registration moved here, so it was deleted from `apps/web/src/lib/utils.ts` rather than kept as dead
code.

## Tests

No `bun test` in this package: it has no host contract or standalone logic to unit-test beyond what
pdf.js itself already provides. The behavioural coverage is `e2e/plugins/pdf-preview/` (moved from the
PDF cases that used to live in `e2e/files.spec.ts`), driving the real viewer end to end.
