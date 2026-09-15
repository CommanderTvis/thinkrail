---
id: submodule-web-components-ui
type: submodule-design
status: deprecated
title: components/ui — shadcn primitives
parent: module-web
tags: [v1, ui]
---

## Moved

The shadcn/ui primitives this module owned (`button`, `dialog`, `dropdown-menu`, `context-menu`,
`popover`, `command`, `textarea`, `tooltip` + `IconTooltip`, `resizable`, `toast`) now live in
`packages/plugin-ui` (`@thinkrail/plugin-ui`), imported from its root barrel. See
`packages/plugin-ui/SPEC.md` for the boundary, public surface, and the "get right" notes this file
used to carry (tooltip pointer-transparency, `wrapTrigger`, hoverable-content, the menu content
height bound). This directory keeps no code; it exists so old links to this spec still resolve.
