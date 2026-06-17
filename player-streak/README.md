# PlayerStreak

PlayerStreak tracks per-player wins, losses, and current streaks for Rocket
League matches and exposes a small overlay visual for player-focused layouts.

## Exports

- Visual: `playerStreak`
- Service: `playerStreak`

## Behavior

- Listens to Rocket League match lifecycle events and Cast Package public state.
- Uses `PrimaryId` when available, then falls back to normalized player name.
- Counts a win or loss for every player seen in a match when `MatchEnded`
  reports the winning team.
- Publishes public state to `plugin.com.bakingrl.player-streak.state`.
- Stores global records in package-local storage.
- Keeps session records in memory only, starting from the current service launch.
- Reads Cast Package `plugin.com.bakingrl.cast-package.sequence` for the game
  mode and `plugin.com.bakingrl.cast-package.player-stats` for current match
  players. Cast Package must be enabled for PlayerStreak to count results.

## Package Settings

Package settings define defaults used by new visual instances and by existing
instances that have not overridden the same fields:

- `Default Player Name`
- `Default Record Scope`
- `Default Mode Tracking`
- `Default Theme`
- `Show Player Name By Default`
- `Show Scope And Mode By Default`

## Visual Settings

- `Player Name`: exact player name to display. Leave empty to use the package
  default player name, then the first current player from Cast Package stats.
- `Record Scope`: session or global.
- `Mode Tracking`: all modes together, or separated by the current game mode.
  With separated mode, a `1v1` streak, a `2v2` streak, and a `3v3` streak are
  restored independently when Cast Package reports that mode again.
- `Theme`: clean, broadcast, neon, ribbon, or terminal.
- `Show Player Name`: hides the name when the visual is used as a pure counter.
- `Show Scope And Mode`: hides the small context line.

The visual default size is 420x120 and is responsive to its assigned overlay
rectangle.

## Capabilities

- Reads Rocket League match lifecycle events.
- Reads Cast Package sequence and player-stats state.
- Writes package-scoped registry state.
- Uses `plugin://self/*` storage for global player records.
- Declares capabilities in the plugin manifest via `services` and package-level `settings`.
