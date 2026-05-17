# Cast Package

Combined cast overlays and controls for BakingRL.

## Exports

- Visuals: `boControl`, `scoreboard`, `goalAnimation`, `victoryAnimation`, `playerBoost`, `playerStatLive`, `teamPreviewLive`, `cageStats`, `statistics`, `fullscreenStats`
- Services: `boTracker`, `gameSequence`, `playerStatsTracker`, `cageStats`, `regieController`
- Page: `control`

The BO state event and registry key use
`plugin.com.bakingrl.cast-package.state` so they stay within the package
permission boundary. Consumers read the fields they need from that single state
payload.

The game sequence helper publishes `plugin.com.bakingrl.cast-package.sequence`.
It summarizes the current Rocket League context for other visuals or packages:
menu versus training versus match versus replay source, a small phase enum,
minimal flags, and an inferred mode label. The mode stays `unknown` until
`CountdownBegin`; before that the service only tracks player counts internally.

The player stats tracker publishes `plugin.com.bakingrl.cast-package.player-stats`.
It aggregates per-player and per-team stats by BO match and across the whole BO:
score, goals, shots, assists, saves, touches, demos, boost consumed, times
demoed, demo differential, average speed, time at zero boost, shooting accuracy,
goal participation, percent supersonic, and percent in the air
(`bOnGround === false`). `snapshot` can return the full state or filter by
`scope`, `matchGuid`, `matchIndex`, `playerId`, `playerName`, and `teamNum`.
Boost consumption, speed, and time percentages are runtime measurements derived
from successive live gameplay `UpdateState` frames only, using the game sequence
service to ignore replay, pause, menu, podium, and non-match phases.

The cage stats service publishes `plugin.com.bakingrl.cast-package.cage-stats`.
It tracks goals, crossbar hits, and saves as projected cage coordinates. The
`cageStats` visual renders one or both cages in the same compact cast style as
the rest of the package and supports team-defense, player-saves, and
player-offense scopes.

`statistics` and `cageStats` are reusable visual elements intended to be placed
and customized directly in layouts. `fullscreenStats` is the event-layer visual:
the regie can trigger it as cage stats, head-to-head, team detail, or team
summary using the same claw transition as `goalAnimation` and `victoryAnimation`.

The regie controller publishes `plugin.com.bakingrl.cast-package.regie`.
The control page calls it through RPC to trigger the `fullscreenStats` event
visual; it activates itself with `context.setActive`.
