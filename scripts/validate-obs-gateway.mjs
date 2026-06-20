#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionSource = readFileSync(resolve(rootDir, "obs-gateway/src/extension/index.ts"), "utf8");
const sidecarSource = readFileSync(resolve(rootDir, "obs-gateway/sidecar/src/main.rs"), "utf8");

assert.match(
  extensionSource,
  /context\.resources\.list\(\{\s*visibility:\s*"public"\s*\}\)/,
  "obs-gateway extension should discover public resources through the SDK."
);
assert.match(
  extensionSource,
  /renderer-module/,
  "obs-gateway extension should build layouts from renderer-module resources."
);
assert.doesNotMatch(
  extensionSource,
  /Host-owned overlay layout discovery/,
  "obs-gateway extension should not advertise a missing host-owned layout discovery path."
);

assert.doesNotMatch(
  sidecarSource,
  /overlays\/list/,
  "obs-gateway sidecar should not call the old host-owned overlays/list API."
);
assert.match(
  sidecarSource,
  /host_layout_catalog/,
  "obs-gateway sidecar should serve layouts from host data supplied by the extension."
);
assert.match(
  sidecarSource,
  /resources\/list/,
  "obs-gateway sidecar should enrich runtime packages with public resources."
);
assert.match(
  sidecarSource,
  /resources\/read/,
  "obs-gateway sidecar should read renderer modules through the host-mediated resources API."
);
assert.match(
  sidecarSource,
  /packageResourceUrl/,
  "obs-gateway overlay runtime should import renderer modules through resource URLs."
);

console.log("obs-gateway resource contract validation passed.");
