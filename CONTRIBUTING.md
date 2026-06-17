# Contributing

## Requirements

- Node.js 20 or newer.
- npm 10 or newer.
- Local sibling checkout of `BakingRL` for runtime testing.
- Optional local sibling checkout of `BakingRLSDK` when developing unreleased
  SDK, generator, or helper CLI changes.

## Standard Workflow

```sh
npm install
npm run check
npm run build
npm run validate
npm run install:local
```

Create a new package with the published helper CLI installed by this workspace:

```sh
npm run create -- my-package
```

When testing unreleased SDK type or runtime-helper changes:

```sh
cd ../BakingRLSDK
npm install
npm run build
npm install -g . --force
```

After unreleased generator, helper, template, or global command changes:

```sh
cd ../BakingRLSDK
npm install
npm run build
npm install -g . --force
```

Run BakingRL, enable the package, and test it in an overlay layout or custom
page before opening a pull request.

## Package Quality Bar

- The package must build without TypeScript errors.
- The manifest must validate.
- In V4 trusted mode, requested capabilities must be justified by package behavior and declared explicitly in the manifest (`services` and `settings`).
- README files must explain installation, exported capabilities, settings, and
  operational limits.
- Public service methods must have schema files.
