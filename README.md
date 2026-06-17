# BakingRL Plugins

This repository contains first-party and experimental BakingRL plugin packages.

Use this repository when developing plugins. Use `BakingRL` to run the desktop
host application and `BakingRLSDK` for SDK source and package-author
documentation.

## Repository Layout

```txt
cast-package/   Production cast overlays, BO controls, and shared cast stats.
deja-vu/        Service and visual package for player encounter counts.
obs-gateway/    Trusted OBS gateway service skeleton.
player-streak/  Service and visual package for player win/loss streak records.
```

## Local Workspace Setup

Clone the host and plugin repositories side by side for runtime testing:

```txt
perso/
  BakingRL/
  BakingRLPlugins/
```

Install plugin workspace dependencies. Published SDK and helper CLI packages are
installed from npm:

```sh
npm install
npm run check
npm run build
npm run validate
```

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
