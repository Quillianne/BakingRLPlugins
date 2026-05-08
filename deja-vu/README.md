# Deja Vu

Deja Vu keeps a local encounter history for Rocket League players seen in live
matches. The visual stays minimal: it only renders current player names with
their team color on a transparent background.

## Exports

- Visual: `dejaVu`
- Service: `dejaVu`

## Behavior

- Listens to `UpdateState` and match lifecycle events.
- Uses `PrimaryId` when available, then falls back to normalized player name.
- Stores unique match GUIDs per player in package-local storage.
- Publishes public state to `plugin.com.bakingrl.deja-vu.state`.
- Displays only current player names, colored by team.

The public state still exposes previous encounter counts for other visuals or
automation. Those counts exclude the current match, so a value of `0` means the
player has not been seen in any previously recorded match.

## Permissions

- Reads Rocket League roster and match lifecycle events.
- Writes one package registry namespace for live state.
- Uses `plugin://self/*` storage for the local encounter history.
