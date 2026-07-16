# Extended Statistics

Extended Statistics owns the reusable telemetry aggregation layer for first-
party BakingRL plugins.

## Services

- `boTracker`: series configuration, score and winner state.
- `gameSequence`: normalized game phase and mode.
- `playerStatsTracker`: series, match, team and player aggregates.
- `cageStats`: goal, save and crossbar locations.

The `statisticsDashboard` tool webview exposes overview, match and cage views.

## Public state

- `plugin.bakingrl.stats-extended.series`
- `plugin.bakingrl.stats-extended.sequence`
- `plugin.bakingrl.stats-extended.player-stats`
- `plugin.bakingrl.stats-extended.cage-stats`

State is persisted in package-owned storage. Other plugins consume these
events, registry keys or the declared services instead of reprocessing Rocket
League telemetry.
