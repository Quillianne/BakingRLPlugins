# Contributing

## Requirements

- Node.js 20 or newer.
- npm 10 or newer.
- Local sibling checkout of `BakingRLSDK` for SDK source and helper scripts.
- Local sibling checkout of `BakingRL` for runtime testing.

## Standard Workflow

```sh
npm install
npm run check
npm run build
npm run validate
npm run install:local
```

Create a new package with the globally installed local SDK tools:

```sh
cd ../BakingRLSDK
npm install -g .
cd ../BakingRLPlugins
npm run create -- my-package
```

After SDK type or runtime-helper changes:

```sh
cd ../BakingRLSDK
npm run build
```

After generator, helper, template, or global command changes:

```sh
cd ../BakingRLSDK
npm install -g . --force
```

Run BakingRL, enable the package, and test it in an overlay layout or custom
page before opening a pull request.

## Package Quality Bar

- The package must build without TypeScript errors.
- The manifest must validate.
- Runtime permissions must be justified by the package behavior.
- README files must explain installation, exported capabilities, settings, and
  operational limits.
- Public service methods must have schema files.
