#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pocDirs = [
  "poc-simple-node",
  "poc-webview-settings",
  "poc-sidecar",
  "poc-overlay-studio",
  "poc-visual-pack",
  "poc-content-pack"
];
const requiredApi = "2.1.0";
const requiredSchema = "bakingrl.plugin/4";

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isInsideDirectory(parentDir, childPath) {
  const relative = resolve(childPath).slice(resolve(parentDir).length);
  return relative === "" || (relative.startsWith(sep) && !relative.includes(`${sep}..${sep}`));
}

function pathExistsInside(packageDir, relPath, label) {
  if (typeof relPath !== "string" || relPath.trim() === "") {
    fail(`${label} must be a non-empty package-relative path.`);
    return;
  }
  const fullPath = resolve(packageDir, relPath);
  if (!isInsideDirectory(packageDir, fullPath)) {
    fail(`${label} must stay inside its package: ${relPath}`);
    return;
  }
  if (!existsSync(fullPath)) {
    fail(`${label} does not exist: ${relPath}`);
    return;
  }
  if (statSync(fullPath).isFile() && statSync(fullPath).size === 0) {
    fail(`${label} is empty: ${relPath}`);
  }
}

const packages = new Map();

for (const dir of pocDirs) {
  const packageDir = resolve(rootDir, dir);
  const manifestPath = resolve(packageDir, "bakingrl.plugin.json");
  if (!existsSync(manifestPath)) {
    fail(`Missing POC manifest: ${dir}/bakingrl.plugin.json`);
    continue;
  }
  const manifest = readJson(manifestPath);
  packages.set(manifest.id, { dir, packageDir, manifest });

  if (manifest.schemaVersion !== requiredSchema) fail(`${dir}: schemaVersion must be ${requiredSchema}`);
  if (manifest.bakingrlApi !== requiredApi) fail(`${dir}: bakingrlApi must be ${requiredApi}`);

  for (const dependency of manifest.dependencies ?? []) {
    if (!isRecord(dependency) || typeof dependency.packageId !== "string") {
      fail(`${dir}: dependencies entries must include packageId.`);
    }
  }

  const contributes = manifest.contributes ?? {};
  for (const service of contributes.services ?? []) {
    pathExistsInside(packageDir, service.schema, `${dir}: service ${service.id} schema`);
  }
  for (const visual of contributes.visuals ?? []) {
    pathExistsInside(packageDir, visual.entry, `${dir}: visual ${visual.id} entry`);
    if (visual.instanceSettings) {
      pathExistsInside(packageDir, visual.instanceSettings, `${dir}: visual ${visual.id} instanceSettings`);
    }
  }
  for (const webview of contributes.webviews ?? []) {
    pathExistsInside(packageDir, webview.entry, `${dir}: webview ${webview.id} entry`);
  }
  if (contributes.settings?.schema) {
    pathExistsInside(packageDir, contributes.settings.schema, `${dir}: settings schema`);
  }
  for (const point of contributes.extensionPoints ?? []) {
    if (point.schema) pathExistsInside(packageDir, point.schema, `${dir}: extension point ${point.id} schema`);
  }
  for (const resource of contributes.resources ?? []) {
    const hasPath = Object.prototype.hasOwnProperty.call(resource, "path");
    const hasPaths = Object.prototype.hasOwnProperty.call(resource, "paths");
    if (hasPath === hasPaths) fail(`${dir}: resource ${resource.id} must declare path XOR paths.`);
    if (typeof resource.type !== "string" || resource.type.trim() === "") {
      fail(`${dir}: resource ${resource.id} must declare type.`);
    }
    if (hasPath) pathExistsInside(packageDir, resource.path, `${dir}: resource ${resource.id} path`);
    if (hasPaths) {
      if (!Array.isArray(resource.paths) || resource.paths.length === 0) {
        fail(`${dir}: resource ${resource.id} paths must be a non-empty array.`);
      } else {
        for (const [index, resourcePath] of resource.paths.entries()) {
          pathExistsInside(packageDir, resourcePath, `${dir}: resource ${resource.id} paths[${index}]`);
        }
      }
    }
  }
  for (const sidecar of manifest.runtime?.sidecars ?? []) {
    pathExistsInside(packageDir, sidecar.bin, `${dir}: sidecar ${sidecar.id} binary`);
    if (sidecar.healthCheck) {
      if (typeof sidecar.healthCheck.method !== "string" || sidecar.healthCheck.method.trim() === "") {
        fail(`${dir}: sidecar ${sidecar.id} healthCheck.method is required.`);
      }
    }
  }
}

for (const { dir, manifest } of packages.values()) {
  const dependencies = new Set((manifest.dependencies ?? []).map((dependency) => dependency.packageId));
  const services = new Set((manifest.contributes?.services ?? []).map((service) => service.id));
  const visuals = new Set((manifest.contributes?.visuals ?? []).map((visual) => visual.id));
  const resources = new Set((manifest.contributes?.resources ?? []).map((resource) => resource.id));

  for (const point of manifest.contributes?.extensionPoints ?? []) {
    if (point.service && !services.has(point.service)) {
      fail(`${dir}: extension point ${point.id} references unknown service ${point.service}.`);
    }
  }

  for (const contribution of manifest.contributes?.contributions ?? []) {
    const [targetPackageId, targetPointId] = String(contribution.target ?? "").split("/");
    if (!targetPackageId || !targetPointId) {
      fail(`${dir}: contribution ${contribution.id} target must be package.id/extensionPointId.`);
      continue;
    }
    if (targetPackageId !== manifest.id && !dependencies.has(targetPackageId)) {
      fail(`${dir}: contribution ${contribution.id} targets ${targetPackageId} without a dependency.`);
    }
    const targetPackage = packages.get(targetPackageId);
    const targetPoint = targetPackage?.manifest.contributes?.extensionPoints?.find((point) => point.id === targetPointId);
    if (!targetPoint) {
      fail(`${dir}: contribution ${contribution.id} targets missing extension point ${contribution.target}.`);
    }
    if (contribution.dataSchema) {
      pathExistsInside(resolve(rootDir, dir), contribution.dataSchema, `${dir}: contribution ${contribution.id} dataSchema`);
    }
    if (contribution.visual && !visuals.has(contribution.visual)) {
      fail(`${dir}: contribution ${contribution.id} references unknown visual ${contribution.visual}.`);
    }
    if (contribution.service && !services.has(contribution.service)) {
      fail(`${dir}: contribution ${contribution.id} references unknown service ${contribution.service}.`);
    }
    for (const resourceId of contribution.resources ?? []) {
      if (!resources.has(resourceId)) {
        fail(`${dir}: contribution ${contribution.id} references unknown resource ${resourceId}.`);
      }
    }
  }
}

if (!process.exitCode) {
  console.log("POC plugin chain validation passed.");
}
