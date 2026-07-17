#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { extractZipEntries, safeArtifactTarget, smokeNodeEntry } from "./lib/release-artifact.mjs";
import { readZipEntries } from "./lib/read-zip-entries.mjs";

const expectedPackageIds = [
  "bakingrl.broadcast-visuals",
  "bakingrl.layout-studio",
  "bakingrl.stats-extended",
  "com.bakingrl.deja-vu",
  "com.bakingrl.player-streak"
];
const artifactRoot = resolve(process.argv[2] ?? "portable-artifacts");
const bundlePaths = listFiles(artifactRoot).filter((path) => path.endsWith(".brlp"));
const extractionRoot = mkdtempSync(join(tmpdir(), "bakingrl-portable-artifacts-"));

try {
  const packageIds = [];
  for (const bundlePath of bundlePaths) {
    const entries = readZipEntries(readFileSync(bundlePath));
    const manifestEntry = entries.get("bakingrl.plugin.json");
    assert.ok(manifestEntry, `${bundlePath} must contain bakingrl.plugin.json.`);
    const manifest = JSON.parse(manifestEntry.toString("utf8"));
    const packageDir = resolve(extractionRoot, manifest.id);
    extractZipEntries(entries, packageDir);

    assert.equal((manifest.runtime?.sidecars ?? []).length, 0, `${manifest.id} must remain a portable plugin.`);
    const nodeEntry = manifest.runtime?.node?.entry;
    assert.equal(typeof nodeEntry, "string", `${manifest.id} must declare a Node runtime entry.`);
    const entryPath = safeArtifactTarget(packageDir, nodeEntry);
    smokeNodeEntry(entryPath, manifest.id);
    packageIds.push(manifest.id);
  }

  assert.deepEqual(packageIds.sort(), expectedPackageIds, "Portable release must contain every expected plugin exactly once.");
  console.log(`Validated and imported ${packageIds.length} portable release artifact(s) on ${process.platform}.`);
} finally {
  rmSync(extractionRoot, { recursive: true, force: true });
}

function listFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}
