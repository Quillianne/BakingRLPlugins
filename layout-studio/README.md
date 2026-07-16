# Layout Studio

Layout Studio owns the broadcast layout document contract and its editor.

## Layout service

`bakingrl.layout-studio/layoutStudio` exposes:

- `snapshot`, `catalog`, `list`, `get`
- `save`, `remove`, `duplicate`, `setActive`
- `resourceSource` for public catalogue modules used by the editor preview

Documents are stored in `layouts.json`. A document contains a fixed canvas,
ordered layers and visual, text, shape or image items. The active document is
the default stream layout used by OBS Gateway.

## Visual contributions

Visual plugins depend on Layout Studio and target:

```text
bakingrl.layout-studio/visual
```

Each contribution references a public ESM renderer resource, a default size,
a category and explicit remote compatibility. The editor uses the same module
contract as the OBS renderer.

## Editor

The `studio` tool webview supports multiple layouts, layers, native items,
catalogue search, drag, resize, ordering, visibility, locking, opacity,
duplication and active-layout selection.
