#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = resolve(rootDir, "node_modules/@bakingrl/create-plugin/lib/bakingrl-plugin.mjs");
const packagesDir = mkdtempSync(resolve(tmpdir(), "bakingrl-local-install-"));
const pocDirs = [
  "poc-simple-node",
  "poc-webview-settings",
  "poc-sidecar",
  "poc-overlay-studio",
  "poc-visual-pack",
  "poc-content-pack"
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function runCli(command, packageDir) {
  execFileSync(process.execPath, [cliPath, command, packageDir], {
    cwd: rootDir,
    env: {
      ...process.env,
      BAKINGRL_PACKAGES_DIR: packagesDir
    },
    stdio: "pipe"
  });
}

function assertFile(path, label) {
  assert.ok(existsSync(path), `${label} should exist: ${path}`);
  assert.ok(statSync(path).isFile(), `${label} should be a file: ${path}`);
}

function assertInstalledPath(installedDir, relPath, label) {
  assertFile(resolve(installedDir, relPath), label);
}

try {
  for (const dir of pocDirs) {
    const packageDir = resolve(rootDir, dir);
    const manifest = readJson(resolve(packageDir, "bakingrl.plugin.json"));
    runCli("pack", packageDir);
    runCli("install-local", packageDir);

    const bundlePath = resolve(packageDir, "dist-bundles", `${manifest.id}-${manifest.version}.brlp`);
    assertFile(bundlePath, `${dir} bundle`);

    const installedDir = resolve(packagesDir, manifest.id);
    const installedManifest = readJson(resolve(installedDir, "bakingrl.plugin.json"));
    assert.equal(installedManifest.id, manifest.id, `${dir} installed manifest id`);
    assert.equal(installedManifest.bakingrlApi, manifest.bakingrlApi, `${dir} installed runtime API`);

    if (manifest.runtime?.node?.entry) {
      assertInstalledPath(installedDir, manifest.runtime.node.entry, `${dir} runtime entry`);
    }
    for (const sidecar of manifest.runtime?.sidecars ?? []) {
      assertInstalledPath(installedDir, sidecar.bin, `${dir} sidecar ${sidecar.id}`);
    }
    for (const webview of manifest.contributes?.webviews ?? []) {
      assertInstalledPath(installedDir, webview.entry, `${dir} webview ${webview.id}`);
    }
    for (const service of manifest.contributes?.services ?? []) {
      assertInstalledPath(installedDir, service.schema, `${dir} service ${service.id} schema`);
    }
    for (const resource of manifest.contributes?.resources ?? []) {
      if (typeof resource.path === "string") {
        assertInstalledPath(installedDir, resource.path, `${dir} resource ${resource.id}`);
      }
      for (const path of resource.paths ?? []) {
        assertInstalledPath(installedDir, path, `${dir} resource ${resource.id}`);
      }
    }
  }

  const installedIds = pocDirs
    .map((dir) => readJson(resolve(rootDir, dir, "bakingrl.plugin.json")).id)
    .sort();
  const actualIds = pocDirs
    .map((dir) => readJson(resolve(rootDir, dir, "bakingrl.plugin.json")).id)
    .filter((id) => existsSync(resolve(packagesDir, id, "bakingrl.plugin.json")))
    .sort();
  assert.deepEqual(actualIds, installedIds);

  console.log(`POC local install validation passed in ${packagesDir}.`);
} finally {
  rmSync(packagesDir, { recursive: true, force: true });
}
