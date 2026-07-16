# Broadcast Visuals

Broadcast Visuals is the first-party visual library for Layout Studio.

## Catalogue

- Scoreboard
- Goal and victory scenes
- Player boost and live player statistics
- Team events
- Cage statistics
- Match and fullscreen statistics

Every visual is a public ESM renderer module contributed to
`bakingrl.layout-studio/visual` and marked as OBS-compatible. Data comes from
Rocket League telemetry and Extended Statistics.

The `broadcastControls` tool webview provides BO and regie controls without
placing the control surface inside an overlay layout. The package-owned
`regieController` service publishes
`plugin.bakingrl.broadcast-visuals.regie`.
