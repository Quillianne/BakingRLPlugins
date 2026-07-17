#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(rootDir, "obs-gateway/bakingrl.plugin.json"), "utf8"));
const settingsSchema = JSON.parse(readFileSync(resolve(rootDir, "obs-gateway/src/settings.schema.json"), "utf8"));
const viteConfig = readFileSync(resolve(rootDir, "obs-gateway/vite.config.ts"), "utf8");
const extensionSource = readFileSync(resolve(rootDir, "obs-gateway/src/extension/index.ts"), "utf8");
const configWebviewSource = readFileSync(resolve(rootDir, "obs-gateway/src/webviews/config/index.ts"), "utf8");
const sidecarSource = readFileSync(resolve(rootDir, "obs-gateway/sidecar/src/main.rs"), "utf8");
const readme = readFileSync(resolve(rootDir, "obs-gateway/README.md"), "utf8");
const configWebview = manifest.contributes?.webviews?.find((webview) => webview.id === "obsGatewayConfig");
const defaultListenPort = settingsSchema.properties?.listenPort?.default;

assert.equal(configWebview?.kind, "settings", "OBS Gateway config UI must be a settings webview.");
assert.equal(configWebview?.entry, "dist/webviews/config.js", "OBS Gateway config UI must build as a webview entry.");
assert.match(viteConfig, /"webviews\/config": "src\/webviews\/config\/index\.ts"/, "OBS Gateway must build its settings webview.");
assert.equal(defaultListenPort, 17844, "OBS Gateway must use the dedicated BakingRL port by default.");
assert.match(
  configWebviewSource,
  new RegExp(`const DEFAULT_LISTEN_PORT = ${defaultListenPort}`),
  "OBS Gateway settings webview must share the schema default port."
);
assert.match(
  sidecarSource,
  new RegExp(`const DEFAULT_LISTEN_PORT: u16 = ${String(defaultListenPort).replace(/(?=\d{3}$)/, "_")}`),
  "OBS Gateway sidecar must share the schema default port."
);
assert.match(sidecarSource, /listen_port: DEFAULT_LISTEN_PORT/, "OBS Gateway sidecar config must use the shared default port.");
assert.match(readme, new RegExp(`127\\.0\\.0\\.1:${defaultListenPort}`), "OBS Gateway README must document the default endpoint.");

assert.ok(
  manifest.dependencies?.some((dependency) => dependency.packageId === "bakingrl.layout-studio"),
  "OBS Gateway must depend on Layout Studio."
);
assert.ok(
  manifest.permissions?.bus?.read?.includes("plugin.bakingrl.layout-studio.changed"),
  "OBS Gateway must subscribe to Layout Studio changes."
);
assert.match(
  extensionSource,
  /context\.services\.call<LayoutSnapshot>\(LAYOUT_SERVICE_REF, "snapshot"/,
  "OBS Gateway must consume the Layout Studio snapshot service."
);
assert.match(
  extensionSource,
  /context\.bus\.subscribe\(LAYOUT_CHANGED_EVENT/,
  "OBS Gateway must refresh when a saved layout changes."
);
assert.doesNotMatch(
  extensionSource,
  /resources\.list|rendererLayoutFor|renderer-module/,
  "OBS Gateway must not synthesize layouts from renderer resources."
);

assert.doesNotMatch(sidecarSource, /overlays\/list|pages\/list|visuals\/readSource/, "OBS Gateway must not use removed host APIs.");
assert.match(sidecarSource, /host_layout_catalog/, "OBS Gateway must serve host data supplied by the extension.");
assert.match(sidecarSource, /resources\/list/, "OBS Gateway must expose installed public renderer resources.");
assert.match(sidecarSource, /resources\/read/, "OBS Gateway must read public renderer modules through the host.");
assert.match(sidecarSource, /packageResourceUrl/, "The OBS runtime must import renderer modules through resource URLs.");
assert.match(sidecarSource, /layoutLayers\(layout\)/, "The OBS runtime must preserve Layout Studio layers.");
assert.doesNotMatch(sidecarSource, /legacy_snapshot_route|legacy-main/, "OBS Gateway must not retain removed layout compatibility paths.");

console.log("OBS Gateway Layout Studio contract validation passed.");
