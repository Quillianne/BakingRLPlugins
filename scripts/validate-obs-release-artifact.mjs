#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractZipEntries, safeArtifactTarget, smokeNodeEntry } from "./lib/release-artifact.mjs";
import { readZipEntries } from "./lib/read-zip-entries.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = resolve(rootDir, "obs-gateway");
const workspaceManifest = readJson(resolve(packageDir, "bakingrl.plugin.json"));
const platform = process.argv[2] ?? currentPlatform();
const supportedPlatforms = new Set(["darwin-arm64", "darwin-x64", "linux-x64", "windows-x64"]);

assert.ok(supportedPlatforms.has(platform), `Unsupported OBS artifact platform: ${platform}`);

const bundlePath = resolve(
  packageDir,
  "dist-bundles",
  `${workspaceManifest.id}-${workspaceManifest.version}.brlp`
);
const entries = readZipEntries(readFileSync(bundlePath));
const bundledManifest = JSON.parse(requireEntry(entries, "bakingrl.plugin.json").toString("utf8"));
const sidecar = bundledManifest.runtime?.sidecars?.find((item) => item.id === "gateway");
const nodeEntry = bundledManifest.runtime?.node?.entry;

assert.ok(sidecar, "OBS Gateway bundle must declare the gateway sidecar.");
assert.equal(typeof nodeEntry, "string", "OBS Gateway bundle must declare its Node runtime entry.");
assert.equal(sidecar.bin, "bin/obs-gateway-sidecar.exe", "OBS Gateway sidecar path must stay Windows-executable.");
assert.ok(entries.has(sidecar.bin), `OBS Gateway bundle is missing ${sidecar.bin}.`);
assert.ok(!entries.has("bin/obs-gateway-sidecar"), "OBS Gateway bundle must not leak the obsolete extensionless sidecar.");

const bundledBinary = requireEntry(entries, sidecar.bin);
const workspaceBinary = readFileSync(resolve(packageDir, sidecar.bin));
assert.deepEqual(bundledBinary, workspaceBinary, "OBS Gateway bundle must contain the built sidecar unchanged.");
assertPlatformBinary(bundledBinary, platform);
smokeArtifact(entries, sidecar.bin, nodeEntry, bundledManifest.id);

console.log(`OBS Gateway ${platform} release artifact validation passed.`);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function requireEntry(entries, name) {
  const contents = entries.get(name);
  assert.ok(contents, `OBS Gateway bundle entry is missing: ${name}`);
  return contents;
}

function assertPlatformBinary(binary, targetPlatform) {
  if (targetPlatform === "windows-x64") {
    assert.equal(binary.subarray(0, 2).toString("ascii"), "MZ", "Windows OBS sidecar must be a PE executable.");
    const peOffset = binary.readUInt32LE(0x3c);
    assert.equal(binary.subarray(peOffset, peOffset + 4).toString("binary"), "PE\0\0", "Windows OBS sidecar must contain a PE header.");
    assert.equal(binary.readUInt16LE(peOffset + 4), 0x8664, "Windows OBS sidecar must target x86-64.");
    return;
  }
  if (targetPlatform === "linux-x64") {
    assert.deepEqual([...binary.subarray(0, 4)], [0x7f, 0x45, 0x4c, 0x46], "Linux OBS sidecar must be ELF.");
    assert.equal(binary.readUInt16LE(18), 0x3e, "Linux OBS sidecar must target x86-64.");
    return;
  }

  assert.equal(binary.readUInt32LE(0), 0xfeedfacf, "macOS OBS sidecar must be a 64-bit Mach-O executable.");
  const expectedCpu = targetPlatform === "darwin-arm64" ? 0x0100000c : 0x01000007;
  assert.equal(binary.readUInt32LE(4), expectedCpu, `macOS OBS sidecar must target ${targetPlatform}.`);
}

function smokeArtifact(entries, declaredPath, nodeEntry, packageId) {
  const temporaryDir = mkdtempSync(join(tmpdir(), "bakingrl-obs-artifact-"));
  try {
    extractZipEntries(entries, temporaryDir);
    const executable = safeArtifactTarget(temporaryDir, declaredPath);
    const extensionEntry = safeArtifactTarget(temporaryDir, nodeEntry);
    // The host normalizes declared sidecars to executable after extraction on Unix.
    if (process.platform !== "win32") chmodSync(executable, 0o755);
    smokeNodeEntry(extensionEntry, packageId);
    const result = spawnSync(executable, [], {
      encoding: "utf8",
      input: [
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "snapshot", params: {} }),
        JSON.stringify({ jsonrpc: "2.0", method: "bakingrl/shutdown", params: {} }),
        ""
      ].join("\n"),
      timeout: 5000,
      windowsHide: true
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `OBS sidecar smoke failed: ${result.stderr || result.stdout}`);
    const response = result.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .find((message) => message.id === 1);
    assert.ok(response?.result, "OBS sidecar smoke must return a snapshot response.");
    assert.equal(response.error, undefined, "OBS sidecar smoke must not return a JSON-RPC error.");
  } finally {
    rmSync(temporaryDir, { recursive: true, force: true });
  }
}

function currentPlatform() {
  const key = `${process.platform}:${process.arch}`;
  return {
    "darwin:arm64": "darwin-arm64",
    "darwin:x64": "darwin-x64",
    "linux:x64": "linux-x64",
    "win32:x64": "windows-x64"
  }[key] ?? "unknown";
}
