# Layout Studio

Layout Studio owns the broadcast layout document contract and its editor.

## Layout service

`bakingrl.layout-studio/layoutStudio` exposes:

- `snapshot`, `catalog`, `list`, `get`
- `save`, `remove`, `duplicate`, `setActive`
- `resourceSource` as a compatibility reader for declared public catalogue modules

Documents are stored in `layouts.json`. A document contains a fixed canvas,
ordered layers and visual, text, shape or image items. The active document is
the default stream layout used by OBS Gateway.

## Visual contributions

Visual plugins depend on Layout Studio and target:

```text
bakingrl.layout-studio/visual
```

Each contribution references a public ESM renderer resource, a default size,
a category and explicit remote compatibility. Layout Studio preserves that
reference for output surfaces, but the editor never reads or evaluates the
renderer module. OBS and other output surfaces render it under their dedicated
runtime boundary.

## Editor

The `studio` tool webview supports multiple layouts, layers, native items,
catalogue search, drag, resize, ordering, visibility, locking, opacity,
duplication and active-layout selection. Plugin visuals use an inert placeholder
inside the editor so untrusted renderer code cannot inherit Layout Studio's
runtime authority.
