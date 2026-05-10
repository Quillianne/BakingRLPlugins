# Deja Vu

Deja Vu keeps a local encounter history for Rocket League players seen in live
matches. The visual stays minimal: it renders current player names and previous
encounter counts with their team color on a transparent background.
Its default visual size is 300x100, with a configurable text size.

## Exports

- Visual: `dejaVu`
- Service: `dejaVu`

## Behavior

- Listens to `UpdateState` and match lifecycle events.
- Uses `PrimaryId` when available, then falls back to normalized player name.
- Stores unique match GUIDs per player in package-local storage.
- Publishes public state to `plugin.com.bakingrl.deja-vu.state`.
- Displays current player names with their previous encounter count, colored by
  team.

The displayed count excludes the current match, so a value of `0` means the
player has not been seen in any previously recorded match.

## Permissions

- Reads Rocket League roster and match lifecycle events.
- Writes one package registry namespace for live state.
- Uses `plugin://self/*` storage for the local encounter history.
