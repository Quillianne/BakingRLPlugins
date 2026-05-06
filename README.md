# BakingRL Plugins

This repository contains first-party and experimental BakingRL plugin packages.

Use this repository when developing plugins. Use `BakingRL` to run the desktop
host application and `BakingRLSDK` for SDK and package-author documentation.

## Repository Layout

```txt
scoreboard/    Visual overlay package for live score display.
bo-tracker/    Service package for best-of series state.
```

## Local Workspace Setup

Clone the three repositories side by side:

```txt
perso/
  BakingRL/
  BakingRLSDK/
  BakingRLPlugins/
```

Install plugin workspace dependencies:

```sh
npm install
npm run check
npm run build
npm run validate
```

## Create A New Plugin

Until the SDK is published, install the local SDK repository globally:

```sh
cd ../BakingRLSDK
npm install
npm install -g .
```

Then create plugins from this repository:

```sh
cd ../BakingRLPlugins
create-bakingrl-plugin my-package
```

Equivalent npm script:

```sh
npm run create -- my-package
```

When you edit SDK types or runtime helpers, rebuild the SDK before rebuilding
plugins:

```sh
cd ../BakingRLSDK
npm run build
```

If you changed the generator, package helper, templates, or global command
metadata, refresh the global local install:

```sh
cd ../BakingRLSDK
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
