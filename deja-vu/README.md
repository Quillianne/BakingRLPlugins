# Deja Vu

Deja Vu keeps a local encounter history for Rocket League players seen in live
matches. The visual stays minimal: it renders current player names and previous
encounter counts with their team color on a transparent background.
Its default visual size is 300x100 and it scales to the assigned visual
rectangle.

## Exports

- Visual: `dejaVu`
- Service: `dejaVu`

## Behavior

- Listens to `UpdateState` and match lifecycle events.
- Uses `PrimaryId` when available, then falls back to normalized player name.
- Stores unique match GUIDs per player in package-local storage.
- Publishes public state to `plugin.com.bakingrl.deja-vu.state`.
- Groups current players by team with the team color and each player's previous
  encounter count.
- Displays current player names with their previous encounter count, colored by
  team.

The displayed count excludes the current match, so a value of `0` means the
player has not been seen in any previously recorded match.

## Settings

- `Local Player Name`: removes the matching player from the visual. Matching is
  exact after trimming whitespace and ignoring case. The player remains in the
  stored encounter history; this only affects rendering.

## Capabilities

- Reads Rocket League roster and match lifecycle events.
- Writes package-scoped registry state.
- Uses `plugin://self/*` storage for the local encounter history.
- Declares capabilities in the plugin manifest via `services` and package-level `settings`.
