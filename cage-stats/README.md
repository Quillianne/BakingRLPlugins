# Cage Stats

BakingRL plugin for tracking goals, crossbar hits, and saves per cage.

## Capabilities

- Service export: `cageStats`
- Visual export: `cageStats`
- Component export: `cageMap`
- Page template: `demo`
- Publishes bus event: `plugin.com.bakingrl.cage-stats.state`
- Writes registry key: `plugin.com.bakingrl.cage-stats.state`

## Projection Model

The default Rocket League projection uses:

- `Y` as the goal-depth axis.
- `X/Z` as the displayed cage plane.
- negative `Y` as the side 0 cage.
- positive `Y` as the side 1 cage.

Goals and crossbar hits use their event coordinates directly. Saves use the
latest useful `BallHit`, preferring a hit involving the saving player and
falling back to the latest match hit.

Goals use the player credited by Rocket League. The service does not infer own
goals.

Crossbar hits are debounced for one second per cage. If a goal is detected on
the same cage within that window, the crossbar is discarded because the shot did
not stay out.

The `cageMap` component renders the same rectangular cage projection as the
visual: green circles for goals, red crosses for crossbars, and red circles for
saves. The visual keeps event counts subtle and does not render an event
history.

## Visual Settings

The `demo` page mounts the visual with `showControls: true`, so scope options
can be changed directly with inputs.

The same visual can also be reused in pages and overlays:

- `{ "scope": "bothCages" }`
- `{ "scope": "teamDefense", "teamNum": 0 }`
- `{ "scope": "playerSaves", "playerName": "PlayerA" }`
- `{ "scope": "playerOffense", "playerName": "PlayerA" }`
- `{ "scope": "bothCages", "showControls": true }`

## Build And Validate

```sh
npm run build
npm run validate
```
