# BakingRLPlugins

First-party plugins for the BakingRL Runtime API 2.3 platform.

## Product plugins

- `stats-extended/`: persistent series, player, team and cage statistics.
- `layout-studio/`: layout documents, visual catalogue and layout editor.
- `broadcast-visuals/`: first-party scoreboard, event and statistics visuals.
- `obs-gateway/`: local HTTP gateway for OBS browser sources.
- `player-streak/`: player win/loss streak service and visual.
- `deja-vu/`: encounter history service and visual.

The product dependency direction is intentional:

```text
Extended Statistics -> Layout Studio -> Broadcast Visuals
                               |
                               +-> OBS Gateway
```

Visual plugins contribute public renderer modules to
`bakingrl.layout-studio/visual`. Layout Studio owns the saved documents. OBS
Gateway consumes those documents through `bakingrl.layout-studio/layoutStudio`
and never invents layouts from arbitrary resources.

## Runtime fixtures

`poc-simple-node/`, `poc-webview-settings/`, `poc-sidecar/` and the remaining
POC chain exercise SDK contracts. They have no marketplace listing and are not
included in release packaging.

## Development

```sh
npm install
npm run check
npm run build
npm run validate
```

The release-equivalent SDK test builds local tarballs, installs their contents
as real packages in a temporary workspace, then repeats all checks:

```sh
npm run validate:local-sdk-pack
```

To test packages in the local BakingRL application data directory:

```sh
npm run install:local --workspace @bakingrl-plugins/stats-extended
npm run install:local --workspace @bakingrl-plugins/layout-studio
npm run install:local --workspace @bakingrl-plugins/broadcast-visuals
npm run install:local --workspace @bakingrl-plugins/obs-gateway
```

## Release

`npm run pack:release -- --sign <key-file>` signs and packs only workspaces
with `marketplace/listing.json`. Generated bundles, hashes, signatures, native
binaries and signing keys are not committed.

Plugins execute with the permissions declared in their manifests. BakingRL
verifies package integrity and publisher identity, not plugin behavior. Users
must trust the publisher before installation; no warranty is provided.
