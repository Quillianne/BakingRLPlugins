# POC Webview Settings

Validation package for host-owned package settings and plugin webviews.

- Declares a package settings schema.
- Declares a `settings` webview contribution.
- Exposes `openSettings` and `settingsSnapshot` service methods.
- The webview uses the host settings bridge and reacts to host setting updates.
- The webview resolves a package-local SVG through `context.assets.url`.
