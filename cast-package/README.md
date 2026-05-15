# Cast Package

Combined cast overlays and controls for BakingRL.

## Exports

- Visuals: `scoreboard`, `controlPanel`, `goal`, `victory`, `playerBoost`, `playerStats`, `teamEvents`
- Services: `boTracker`, `gameSequence`
- Page: `control`

The BO state event and registry key use `plugin.com.bakingrl.cast-package.state` so they stay within the package permission boundary.

The game sequence helper publishes `plugin.com.bakingrl.cast-package.sequence`.
It summarizes the current Rocket League context for other visuals or packages:
menu versus training versus match versus replay source, a small phase enum,
minimal flags, and an inferred mode label. The mode stays `unknown` until
`CountdownBegin`; before that the service only tracks player counts internally.
