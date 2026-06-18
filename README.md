# BakingRL Plugins

This repository contains first-party and experimental BakingRL plugin packages.

Use this repository when developing plugins. Use `BakingRL` to run the desktop
host application and `BakingRLSDK` for SDK source and package-author
documentation.

## Repository Layout

```txt
cast-package/   Production cast overlays, BO controls, and shared cast stats.
deja-vu/        Service and visual package for player encounter counts.
obs-gateway/    Trusted Rust sidecar OBS gateway service.
player-streak/  Service and visual package for player win/loss streak records.

poc-simple-node/        Runtime API 2.2 Node service and RL snapshot POC.
poc-webview-settings/   Runtime API 2.2 settings and webview POC.
poc-sidecar/            Runtime API 2.2 managed sidecar health/crash POC.
poc-overlay-studio/     Runtime API 2.2 platform plugin POC.
poc-visual-pack/        Runtime API 2.2 Overlay Studio contributor POC.
poc-content-pack/       Runtime API 2.2 resource-only content contributor POC.
```

## Local Workspace Setup

Clone the host and plugin repositories side by side for runtime testing:

```txt
perso/
  BakingRL/
  BakingRLPlugins/
```

Install plugin workspace dependencies. For refactor validation, build and pack
the sibling `BakingRLSDK` checkout locally, then install that pack into this
workspace before running the checks:

```sh
cd ../BakingRLSDK
npm run check
npm run build
npm pack --workspace @bakingrl/plugin-sdk --pack-destination /tmp/bakingrl-sdk-packs
npm pack --workspace @bakingrl/create-plugin --pack-destination /tmp/bakingrl-sdk-packs
cd ../BakingRLPlugins
npm install
npm install --no-save /tmp/bakingrl-sdk-packs/bakingrl-plugin-sdk-2.2.0.tgz /tmp/bakingrl-sdk-packs/bakingrl-create-plugin-2.2.0.tgz
npm run check
npm run build
npm run validate
npm run validate:poc-chain
```

`validate:poc-chain` reads `BakingRL`'s `HOST_RUNTIME_API_VERSION` and
`BakingRLSDK`'s `RUNTIME_API_VERSION`, then checks the Runtime API 2.2 POC
dependency, contribution, resource, webview, and sidecar declarations locally.
It should run after `npm run build` so built entries and sidecar binaries exist.
The standard `npm run validate` command remains the SDK CLI validation gate and
requires the local SDK validator to understand the Runtime API 2.2 manifest
fields.

## Create A New Plugin

Create plugins from this repository with the workspace script:

```sh
npm run create -- my-package
```

If `@bakingrl/create-plugin` is installed globally, the direct command is also
available:

```sh
create-bakingrl-plugin my-package
```

If you are developing unreleased SDK or generator changes, use a sibling
`BakingRLSDK` checkout and install it globally before creating or rebuilding
plugins:

```sh
cd ../BakingRLSDK
npm install
npm run build
npm install -g . --force
```

Install every built package into the local BakingRL app-data directory:

```sh
npm run install:local
```

Then start BakingRL and reload packages:

```sh
cd ../BakingRL
npm run tauri dev
```

## Plugin Development Rules

- Keep source packages in this repository.
- Do not commit `dist/`, `dist-bundles/`, `manifest.hashes.json`, or signing
  keys unless a release process explicitly requires generated artifacts.
- Keep package IDs stable after public release.
- Keep requested capabilities narrow and declared in each package manifest
  (`settings` and `services`).
- Prefer reusable components and services over duplicated logic.

## Packages

- [Cast Package](cast-package/README.md)
- [Deja Vu](deja-vu/README.md)
- [OBS Gateway](obs-gateway/README.md)
- [PlayerStreak](player-streak/README.md)
- [POC Simple Node](poc-simple-node/README.md)
- [POC Webview Settings](poc-webview-settings/README.md)
- [POC Sidecar](poc-sidecar/README.md)
- [POC Overlay Studio](poc-overlay-studio/README.md)
- [POC Visual Pack](poc-visual-pack/README.md)
- [POC Content Pack](poc-content-pack/README.md)
