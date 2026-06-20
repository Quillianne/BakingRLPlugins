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
const packageIds = {
  simple: "bakingrl.poc-simple-node",
  webviewSettings: "bakingrl.poc-webview-settings",
  sidecar: "bakingrl.poc-sidecar",
  overlay: "bakingrl.poc-overlay-studio",
  visual: "bakingrl.poc-visual-pack",
  content: "bakingrl.poc-content-pack"
};
const legacyContributes = ["pages", "views", "overlays", "configuration", "visuals", "assets", "schemas"];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function runCli(command, packageDir) {
  return execFileSync(process.execPath, [cliPath, command, packageDir], {
    cwd: rootDir,
    env: {
      ...process.env,
      BAKINGRL_PACKAGES_DIR: packagesDir
    },
    stdio: "pipe"
  }).toString("utf8");
}

function runScript(scriptPath, env = {}) {
  return execFileSync(process.execPath, [scriptPath], {
    cwd: rootDir,
    env: {
      ...process.env,
      ...env
    },
    stdio: "pipe"
  }).toString("utf8");
}

function assertFile(path, label) {
  assert.ok(existsSync(path), `${label} should exist: ${path}`);
  assert.ok(statSync(path).isFile(), `${label} should be a file: ${path}`);
}

function assertInstalledPath(installedDir, relPath, label) {
  assertFile(resolve(installedDir, relPath), label);
}

function assertNoLegacyContributes(manifest, label) {
  for (const group of legacyContributes) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(manifest.contributes ?? {}, group),
      false,
      `${label} should not declare legacy contributes.${group}`
    );
  }
}

function assertDependency(manifest, packageId, range, label) {
  const dependency = (manifest.dependencies ?? []).find((item) => item.packageId === packageId);
  assert.ok(dependency, `${label} should depend on ${packageId}`);
  assert.equal(dependency.version, range, `${label} dependency ${packageId} version`);
}

function assertService(manifest, id, runtime, methods, label) {
  const service = (manifest.contributes?.services ?? []).find((item) => item.id === id);
  assert.ok(service, `${label} should expose service ${id}`);
  assert.equal(service.runtime, runtime, `${label} service ${id} runtime`);
  assert.deepEqual(service.methods, methods, `${label} service ${id} methods`);
}

function assertCommand(manifest, id, title, label) {
  const command = (manifest.contributes?.commands ?? []).find((item) => item.id === id);
  assert.ok(command, `${label} should expose command ${id}`);
  assert.equal(command.title, title, `${label} command ${id} title`);
}

function assertWebview(manifest, id, kind, label) {
  const webview = (manifest.contributes?.webviews ?? []).find((item) => item.id === id);
  assert.ok(webview, `${label} should expose webview ${id}`);
  assert.equal(webview.kind, kind, `${label} webview ${id} kind`);
  assert.ok(Array.isArray(webview.defaultSize), `${label} webview ${id} should declare defaultSize`);
}

function assertExtensionPoint(manifest, id, service, label) {
  const point = (manifest.contributes?.extensionPoints ?? []).find((item) => item.id === id);
  assert.ok(point, `${label} should expose extension point ${id}`);
  assert.equal(point.service, service, `${label} extension point ${id} service`);
  assert.equal(point.version, "1.0.0", `${label} extension point ${id} version`);
}

function assertContribution(manifest, id, target, resources, label) {
  const contribution = (manifest.contributes?.contributions ?? []).find((item) => item.id === id);
  assert.ok(contribution, `${label} should contribute ${id}`);
  assert.equal(contribution.target, target, `${label} contribution ${id} target`);
  assert.deepEqual(contribution.resources ?? [], resources, `${label} contribution ${id} resources`);
  assert.equal(
    Object.prototype.hasOwnProperty.call(contribution, "visual"),
    false,
    `${label} contribution ${id} should not use legacy contribution.visual`
  );
  return contribution;
}

function assertResource(manifest, id, type, visibility, role, label) {
  const resource = (manifest.contributes?.resources ?? []).find((item) => item.id === id);
  assert.ok(resource, `${label} should expose resource ${id}`);
  assert.equal(resource.type, type, `${label} resource ${id} type`);
  assert.equal(resource.visibility, visibility, `${label} resource ${id} visibility`);
  assert.equal(resource.metadata?.role, role, `${label} resource ${id} metadata.role`);
  return resource;
}

function assertInstalledPocChain(installedManifests, inspectSummaries) {
  for (const [id, manifest] of installedManifests) {
    assertNoLegacyContributes(manifest, id);
    assert.equal(inspectSummaries.get(id).id, id, `${id} inspect summary id`);
    assert.equal(inspectSummaries.get(id).schemaVersion, "bakingrl.plugin/4", `${id} inspect schema`);
    assert.equal(inspectSummaries.get(id).bakingrlApi, manifest.bakingrlApi, `${id} inspect runtime API`);
  }

  const simple = installedManifests.get(packageIds.simple);
  assertService(simple, "pocSimpleNode", "node", ["ping", "snapshot", "debugState"], packageIds.simple);
  assert.ok(simple.contributes?.settings?.schema, `${packageIds.simple} should declare settings schema`);

  const webviewSettings = installedManifests.get(packageIds.webviewSettings);
  assertCommand(webviewSettings, "openSettings", "Open POC Settings", packageIds.webviewSettings);
  assertService(webviewSettings, "pocWebviewSettings", "node", ["openSettings", "settingsSnapshot"], packageIds.webviewSettings);
  assertWebview(webviewSettings, "settings", "settings", packageIds.webviewSettings);
  assert.ok(webviewSettings.contributes?.settings?.schema, `${packageIds.webviewSettings} should declare settings schema`);

  const sidecar = installedManifests.get(packageIds.sidecar);
  const sidecarWorker = sidecar.runtime?.sidecars?.find((item) => item.id === "worker");
  assert.ok(sidecarWorker, `${packageIds.sidecar} should declare worker sidecar`);
  assert.equal(sidecarWorker.protocol, "jsonrpc-stdio", `${packageIds.sidecar} worker protocol`);
  assert.equal(sidecarWorker.activation, "manual", `${packageIds.sidecar} worker activation`);
  assert.equal(sidecarWorker.healthCheck?.method, "health", `${packageIds.sidecar} worker health method`);
  assertService(sidecar, "pocSidecar", "node", ["ping", "health", "crash"], packageIds.sidecar);
  assertService(sidecar, "pocSidecarNative", "sidecar:worker", ["ping", "health", "crash"], packageIds.sidecar);

  const overlay = installedManifests.get(packageIds.overlay);
  assertService(overlay, "overlayStudio", "node", ["snapshot", "contributions", "renderState"], packageIds.overlay);
  assertWebview(overlay, "studio", "tool", packageIds.overlay);
  assertResource(overlay, "overlayPreviewModule", "application/javascript", "public", "overlay-studio-preview-module", packageIds.overlay);
  assertExtensionPoint(overlay, "overlay-studio.visual", "overlayStudio", packageIds.overlay);

  const visual = installedManifests.get(packageIds.visual);
  assertDependency(visual, packageIds.overlay, "^1.0.0", packageIds.visual);
  assertService(visual, "visualPack", "node", ["snapshot", "content", "renderWidget"], packageIds.visual);
  assertResource(visual, "demoWidgetModule", "application/javascript", "public", "overlay-widget-module", packageIds.visual);
  assertResource(visual, "widgetPreset", "application/json", "public", "widget-preset", packageIds.visual);
  assertExtensionPoint(visual, "visual-pack.content", "visualPack", packageIds.visual);
  const visualContribution = assertContribution(
    visual,
    "demo-score-widget",
    `${packageIds.overlay}/overlay-studio.visual`,
    ["demoWidgetModule", "widgetPreset"],
    packageIds.visual
  );
  assert.equal(visualContribution.service, "visualPack", `${packageIds.visual} contribution service`);
  assert.equal(visualContribution.metadata?.renderer?.kind, "resource-module", `${packageIds.visual} renderer kind`);
  assert.equal(visualContribution.metadata?.renderer?.resource, "demoWidgetModule", `${packageIds.visual} renderer resource`);
  assert.equal(visualContribution.metadata?.contentTarget, `${packageIds.visual}/visual-pack.content`, `${packageIds.visual} content target`);

  const content = installedManifests.get(packageIds.content);
  assertDependency(content, packageIds.visual, "^1.0.0", packageIds.content);
  assertResource(content, "overlayContent", "application/json", "public", "overlay-content", packageIds.content);
  assertResource(content, "badgeSvgs", "image/svg+xml", "public", "team-badges", packageIds.content);
  const contentContribution = assertContribution(
    content,
    "demo-overlay-content",
    `${packageIds.visual}/visual-pack.content`,
    ["overlayContent", "badgeSvgs"],
    packageIds.content
  );
  assert.equal(contentContribution.metadata?.preset, "demo", `${packageIds.content} content preset`);
}

try {
  const installedManifests = new Map();
  const inspectSummaries = new Map();

  for (const dir of pocDirs) {
    const packageDir = resolve(rootDir, dir);
    const manifest = readJson(resolve(packageDir, "bakingrl.plugin.json"));
    runCli("pack", packageDir);
    runCli("install-local", packageDir);

    const bundlePath = resolve(packageDir, "dist-bundles", `${manifest.id}-${manifest.version}.brlp`);
    assertFile(bundlePath, `${dir} bundle`);

    const installedDir = resolve(packagesDir, manifest.id);
    runCli("validate", installedDir);
    const inspected = JSON.parse(runCli("inspect", installedDir));
    const installedManifest = readJson(resolve(installedDir, "bakingrl.plugin.json"));
    assert.equal(installedManifest.id, manifest.id, `${dir} installed manifest id`);
    assert.equal(installedManifest.bakingrlApi, manifest.bakingrlApi, `${dir} installed runtime API`);
    installedManifests.set(installedManifest.id, installedManifest);
    inspectSummaries.set(installedManifest.id, inspected);

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
  assertInstalledPocChain(installedManifests, inspectSummaries);

  const smokeOutput = runScript(resolve(rootDir, "scripts/smoke-runtime-poc.mjs"), {
    BAKINGRL_POC_ROOT_DIR: packagesDir,
    BAKINGRL_POC_SKIP_FRESHNESS: "1"
  });
  assert.match(smokeOutput, /Runtime POC smoke passed\./);

  console.log(`POC local install validation passed in ${packagesDir}.`);
} finally {
  rmSync(packagesDir, { recursive: true, force: true });
}
