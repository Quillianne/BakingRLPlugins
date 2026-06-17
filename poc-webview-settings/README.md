# POC Webview Settings

Validation package for host-owned package settings and plugin webviews.

- Declares a package settings schema.
- Declares a `settings` webview contribution.
- Exposes `openSettings` and `settingsSnapshot` service methods.
- The webview uses the future host settings bridge when available and falls back to an in-memory preview.
