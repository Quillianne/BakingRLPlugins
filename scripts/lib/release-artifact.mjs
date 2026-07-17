import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export function safeArtifactTarget(root, entryPath) {
  assert.equal(isAbsolute(entryPath), false, `Bundle entry must be relative: ${entryPath}`);
  const target = resolve(root, entryPath);
  const rel = relative(root, target);
  assert.ok(rel && rel !== ".." && !rel.startsWith(`..${sep}`), `Bundle entry escapes its package: ${entryPath}`);
  return target;
}

export function extractZipEntries(entries, packageDir) {
  for (const [entryPath, contents] of entries) {
    if (entryPath.endsWith("/")) continue;
    const target = safeArtifactTarget(packageDir, entryPath.replaceAll("\\", "/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
}

export function smokeNodeEntry(entryPath, packageId) {
  const probe = `
    import { pathToFileURL } from "node:url";
    const module = await import(pathToFileURL(process.argv[1]).href);
    const extension = module.default ?? module;
    if (typeof extension.activate !== "function") throw new Error("Artifact does not export activate().");
    if (typeof extension.deactivate !== "function") throw new Error("Artifact does not export deactivate().");
    console.log("bakingrl-entry-ok");
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", probe, entryPath], {
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${packageId} artifact import failed: ${result.stderr || result.stdout}`);
  assert.match(result.stdout, /bakingrl-entry-ok/, `${packageId} artifact import did not complete.`);
}
