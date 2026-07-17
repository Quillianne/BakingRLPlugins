#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeApi = "2.4.0";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function plugin(dir) {
  const packageDir = resolve(rootDir, dir);
  const manifest = readJson(resolve(packageDir, "bakingrl.plugin.json"));
  assert.equal(manifest.bakingrlApi, runtimeApi, `${dir} must target Runtime API ${runtimeApi}.`);
  assert.equal(manifest.schemaVersion, "bakingrl.plugin/4", `${dir} must use manifest V4.`);
  return { dir, packageDir, manifest };
}

function hasDependency(source, packageId) {
  return source.manifest.dependencies?.some((dependency) => dependency.packageId === packageId);
}

function requirePath(source, path, label) {
  assert.ok(existsSync(resolve(source.packageDir, path)), `${label} is missing: ${source.dir}/${path}`);
}

const stats = plugin("stats-extended");
const layouts = plugin("layout-studio");
const visuals = plugin("broadcast-visuals");
const obs = plugin("obs-gateway");
const dejaVu = plugin("deja-vu");
const playerStreak = plugin("player-streak");

assert.equal(stats.manifest.id, "bakingrl.stats-extended");
assert.deepEqual(
  new Set(stats.manifest.contributes.services.map((service) => service.id)),
  new Set(["boTracker", "gameSequence", "playerStatsTracker", "cageStats"]),
  "Extended Statistics must own all reusable telemetry aggregators."
);
assert.ok(stats.manifest.contributes.webviews.some((webview) => webview.id === "statisticsDashboard"));

assert.equal(layouts.manifest.id, "bakingrl.layout-studio");
assert.ok(hasDependency(layouts, stats.manifest.id), "Layout Studio must install Extended Statistics for first-party visual previews.");
const visualPoint = layouts.manifest.contributes.extensionPoints.find((point) => point.id === "visual");
assert.equal(visualPoint?.service, "layoutStudio", "Layout Studio visual contributions must be service-backed.");
assert.ok(layouts.manifest.contributes.services[0].methods.includes("resourceSource"));
const layoutStudioWebviewSource = readFileSync(resolve(layouts.packageDir, "src/webviews/studio/index.ts"), "utf8");
assert.doesNotMatch(
  layoutStudioWebviewSource,
  /mountVisualPreviews|URL\.createObjectURL|new Blob|@vite-ignore|"resourceSource"/,
  "Layout Studio must never load or evaluate contributed renderer modules inside its editor webview."
);
assert.match(
  layoutStudioWebviewSource,
  /Preview disabled in editor/,
  "Layout Studio must explain its inert plugin-visual placeholder."
);

assert.equal(visuals.manifest.id, "bakingrl.broadcast-visuals");
assert.ok(hasDependency(visuals, stats.manifest.id), "Broadcast Visuals must depend on Extended Statistics.");
assert.ok(hasDependency(visuals, layouts.manifest.id), "Broadcast Visuals must depend on Layout Studio.");
assert.ok(visuals.manifest.contributes.webviews.some((webview) => webview.id === "broadcastControls"));
assert.ok(visuals.manifest.contributes.contributions.length >= 9, "Broadcast Visuals must provide the complete first-party catalogue.");
for (const contribution of visuals.manifest.contributes.contributions) {
  assert.equal(contribution.target, "bakingrl.layout-studio/visual", `${contribution.id} must target Layout Studio.`);
  assert.equal(contribution.kind, "visual", `${contribution.id} must be a visual contribution.`);
  assert.equal(contribution.metadata?.renderer?.kind, "resource-module", `${contribution.id} must use a public resource module.`);
  assert.ok(contribution.metadata?.remoteCompatible, `${contribution.id} must be explicitly OBS-compatible.`);
  for (const resourceId of contribution.resources ?? []) {
    assert.ok(
      visuals.manifest.contributes.resources.some((resource) => resource.id === resourceId && resource.visibility === "public"),
      `${contribution.id} references an unavailable public resource: ${resourceId}`
    );
  }
}

assert.equal(obs.manifest.id, "bakingrl.obs-gateway");
assert.ok(hasDependency(obs, layouts.manifest.id), "OBS Gateway must depend on Layout Studio.");

for (const contributor of [visuals, dejaVu, playerStreak]) {
  assert.ok(hasDependency(contributor, layouts.manifest.id), `${contributor.dir} must depend on Layout Studio.`);
  for (const contribution of contributor.manifest.contributes.contributions ?? []) {
    assert.equal(contribution.target, "bakingrl.layout-studio/visual", `${contributor.dir}/${contribution.id} must target Layout Studio.`);
    assert.equal(contribution.metadata?.renderer?.kind, "resource-module", `${contributor.dir}/${contribution.id} must use a resource module.`);
    assert.equal(contribution.metadata?.remoteCompatible, true, `${contributor.dir}/${contribution.id} must be OBS-compatible.`);
  }
}
assert.ok(hasDependency(playerStreak, stats.manifest.id), "PlayerStreak must consume Extended Statistics directly.");

for (const source of [stats, layouts, visuals, obs, dejaVu, playerStreak]) {
  for (const service of source.manifest.contributes.services ?? []) requirePath(source, service.schema, `${source.dir} service schema`);
  for (const webview of source.manifest.contributes.webviews ?? []) requirePath(source, webview.entry.replace(/^dist\//, "src/").replace(/\.js$/, "/index.ts"), `${source.dir} webview source`);
  requirePath(source, "marketplace/listing.json", `${source.dir} marketplace listing`);
}

const productSources = [
  "stats-extended/src/shared/events.ts",
  "broadcast-visuals/src/shared/events.ts",
  "broadcast-visuals/src/visuals/control-panel/index.ts",
  "broadcast-visuals/src/visuals/scoreboard/index.ts"
].map((path) => readFileSync(resolve(rootDir, path), "utf8")).join("\n");
assert.doesNotMatch(productSources, /com\.bakingrl\.cast-package/, "Product plugins must not retain the removed Cast Package contract.");

console.log("BakingRL product plugin chain validation passed.");
