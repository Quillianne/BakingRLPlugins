# Scoreboard

Visual BakingRL plugin for live Rocket League score display.

It displays the current Rocket League score from `UpdateState`. If the separate
`BO Tracker` plugin is installed and currently tracking a best-of series, this
scoreboard detects `plugin.com.bakingrl.bo-tracker.state` and displays the BO
score in the center.

No hard service import is declared, so the scoreboard still works when the BO
Tracker plugin is not installed.

## Capabilities

- Visual export: `scoreboard`
- Reads telemetry event: `UpdateState`
- Optionally reads `plugin.com.bakingrl.bo-tracker.state` when BO Tracker is installed.

## Build And Validate

```sh
npm run build
npm run validate
```
