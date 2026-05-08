# BakingRL Plugins

This repository contains first-party and experimental BakingRL plugin packages.

Use this repository when developing plugins. Use `BakingRL` to run the desktop
host application and `BakingRLSDK` for SDK source and package-author
documentation.

## Repository Layout

```txt
scoreboard/    Visual overlay package for live score display.
bo-tracker/    Service package for best-of series state.
cage-stats/    Service and visual package for cage stats.
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
- Keep requested permissions narrow and documented in each package README.
- Prefer reusable components and services over duplicated logic.

## Packages

- [Scoreboard](scoreboard/README.md)
- [BO Tracker](bo-tracker/README.md)
- [Cage Stats](cage-stats/README.md)
