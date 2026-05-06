# BO Tracker

BakingRL plugin used to track and control best-of series.

## Capabilities

- Service export: `boTracker`
- Visual export: `controlPanel`
- Page template export: `control`
- Publishes bus event: `plugin.com.bakingrl.bo-tracker.state`
- Writes registry key: `plugin.com.bakingrl.bo-tracker.state`
- Uses package-local storage for persistent BO configuration and history.

The `control` page template mounts the `controlPanel` visual. It can:

- Configure team names for Rocket League side 0 and side 1.
- Configure BO1, BO3, BO5, or BO7.
- Start tracking immediately or from the next match.
- Stop tracking without clearing the score.
- Manually adjust, award, undo, or reset series scores.

A scoreboard plugin can consume it by reading:

- bus event: `plugin.com.bakingrl.bo-tracker.state`
- registry key: `plugin.com.bakingrl.bo-tracker.state`
- service: `com.bakingrl.bo-tracker/boTracker`

The scoreboard should treat the BO as active when `state.tracking === true`.
When the BO is complete, `state.phase === "complete"` and `state.winner` is set.

## Service Methods

- `configure(input)` updates BO format, team names, team numbers, and optional start mode.
- `start({ mode })` starts tracking now or waits for the next match.
- `stop()` stops tracking without clearing the score.
- `adjustScore({ leftWins, rightWins })` manually corrects the score.
- `award({ side })` manually awards a match to `left` or `right`.
- `undo()` removes the last counted match.
- `reset({ keepConfig })` resets the BO state.
- `snapshot()` returns the current state.

## Build And Validate

```sh
npm run build
npm run validate
```
