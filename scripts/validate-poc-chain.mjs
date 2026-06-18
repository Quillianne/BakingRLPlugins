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
const requiredApi = "2.2.0";
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

function hasItem(items, expected) {
  return Array.isArray(items) && items.includes(expected);
}

function requirePackage(packageId, label) {
  const item = packages.get(packageId);
  if (!item) {
    fail(`Missing ${label}: ${packageId}`);
  }
  return item;
}

function requireDependency(source, targetPackageId, label) {
  const dependencies = source?.manifest.dependencies ?? [];
  if (!dependencies.some((dependency) => dependency.packageId === targetPackageId)) {
    fail(`${label}: ${source?.dir ?? "unknown package"} must depend on ${targetPackageId}.`);
  }
}

function requireExtensionPoint(source, id, label) {
  const point = source?.manifest.contributes?.extensionPoints?.find((candidate) => candidate.id === id);
  if (!point) {
    fail(`${label}: missing extension point ${id}.`);
  }
  return point;
}

function requireContribution(source, id, target, label) {
  const contribution = source?.manifest.contributes?.contributions?.find((candidate) => candidate.id === id);
  if (!contribution) {
    fail(`${label}: missing contribution ${id}.`);
    return undefined;
  }
  if (contribution.target !== target) {
    fail(`${label}: contribution ${id} must target ${target}.`);
  }
  return contribution;
}

function requireResource(source, id, expected, label) {
  const resource = source?.manifest.contributes?.resources?.find((candidate) => candidate.id === id);
  if (!resource) {
    fail(`${label}: missing resource ${id}.`);
    return undefined;
  }
  const visibility = resource.visibility ?? "private";
  if (visibility !== expected.visibility) {
    fail(`${label}: resource ${id} visibility must be ${expected.visibility}.`);
  }
  if (resource.type !== expected.type) {
    fail(`${label}: resource ${id} type must be ${expected.type}.`);
  }
  if (!isRecord(resource.metadata) || resource.metadata.role !== expected.role) {
    fail(`${label}: resource ${id} metadata.role must be ${expected.role}.`);
  }
  return resource;
}

function requireRendererMetadata(contribution, expectedResourceId, label) {
  const renderer = contribution?.metadata?.renderer;
  if (!isRecord(renderer)) {
    fail(`${label}: contribution ${contribution?.id ?? "unknown"} metadata.renderer is required.`);
    return;
  }
  if (renderer.kind !== "resource-module") {
    fail(`${label}: contribution ${contribution.id} metadata.renderer.kind must be resource-module.`);
  }
  if (renderer.resource !== expectedResourceId) {
    fail(`${label}: contribution ${contribution.id} metadata.renderer.resource must be ${expectedResourceId}.`);
  }
  if (renderer.moduleFormat !== "esm") {
    fail(`${label}: contribution ${contribution.id} metadata.renderer.moduleFormat must be esm.`);
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
  if ((contributes.visuals ?? []).length > 0) {
    fail(`${dir}: POC chain must not declare host-owned contributes.visuals; expose visual modules as resources.`);
  }
  for (const service of contributes.services ?? []) {
    pathExistsInside(packageDir, service.schema, `${dir}: service ${service.id} schema`);
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
    const visibility = resource.visibility ?? "private";
    if (visibility !== "public" && visibility !== "private") {
      fail(`${dir}: resource ${resource.id} visibility must be public or private when declared.`);
    }
    if (visibility === "public" && (typeof resource.type !== "string" || resource.type.trim() === "")) {
      fail(`${dir}: public resource ${resource.id} must declare type.`);
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
    if (Object.prototype.hasOwnProperty.call(contribution, "visual")) {
      fail(`${dir}: contribution ${contribution.id} must not use host-owned contribution.visual; use metadata.renderer.resource.`);
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

const overlayStudio = requirePackage("bakingrl.poc-overlay-studio", "Overlay Studio POC");
const visualPack = requirePackage("bakingrl.poc-visual-pack", "Visual Pack POC");
const contentPack = requirePackage("bakingrl.poc-content-pack", "Content Pack POC");

const overlayPoint = requireExtensionPoint(overlayStudio, "overlay-studio.visual", "Overlay Studio POC");
if (overlayPoint?.service !== "overlayStudio") {
  fail("Overlay Studio POC: overlay-studio.visual must be backed by overlayStudio.");
}
requireResource(
  overlayStudio,
  "overlayPreviewModule",
  { visibility: "public", type: "application/javascript", role: "overlay-studio-preview-module" },
  "Overlay Studio POC"
);

requireDependency(visualPack, "bakingrl.poc-overlay-studio", "Visual Pack POC");
const visualContentPoint = requireExtensionPoint(visualPack, "visual-pack.content", "Visual Pack POC");
if (visualContentPoint?.service !== "visualPack") {
  fail("Visual Pack POC: visual-pack.content must be backed by visualPack.");
}
const visualContribution = requireContribution(
  visualPack,
  "demo-score-widget",
  "bakingrl.poc-overlay-studio/overlay-studio.visual",
  "Visual Pack POC"
);
if (visualContribution) {
  if (visualContribution.service !== "visualPack") fail("Visual Pack POC: demo-score-widget must expose visualPack.");
  for (const resourceId of ["demoWidgetModule", "widgetPreset"]) {
    if (!hasItem(visualContribution.resources, resourceId)) {
      fail(`Visual Pack POC: demo-score-widget must reference ${resourceId}.`);
    }
  }
  if (visualContribution.metadata?.contentTarget !== "bakingrl.poc-visual-pack/visual-pack.content") {
    fail("Visual Pack POC: demo-score-widget metadata.contentTarget must point to visual-pack.content.");
  }
  requireRendererMetadata(visualContribution, "demoWidgetModule", "Visual Pack POC");
}
requireResource(
  visualPack,
  "demoWidgetModule",
  { visibility: "public", type: "application/javascript", role: "overlay-widget-module" },
  "Visual Pack POC"
);
requireResource(
  visualPack,
  "widgetPreset",
  { visibility: "public", type: "application/json", role: "widget-preset" },
  "Visual Pack POC"
);

requireDependency(contentPack, "bakingrl.poc-visual-pack", "Content Pack POC");
if (contentPack?.manifest.runtime) {
  fail("Content Pack POC: resource-only content pack must not declare runtime.");
}
for (const key of ["services", "visuals", "webviews", "extensionPoints"]) {
  if ((contentPack?.manifest.contributes?.[key] ?? []).length > 0) {
    fail(`Content Pack POC: resource-only content pack must not declare contributes.${key}.`);
  }
}
const contentContribution = requireContribution(
  contentPack,
  "demo-overlay-content",
  "bakingrl.poc-visual-pack/visual-pack.content",
  "Content Pack POC"
);
if (contentContribution) {
  for (const resourceId of ["overlayContent", "badgeSvgs"]) {
    if (!hasItem(contentContribution.resources, resourceId)) {
      fail(`Content Pack POC: demo-overlay-content must reference ${resourceId}.`);
    }
  }
}
requireResource(
  contentPack,
  "overlayContent",
  { visibility: "public", type: "application/json", role: "overlay-content" },
  "Content Pack POC"
);
requireResource(
  contentPack,
  "badgeSvgs",
  { visibility: "public", type: "image/svg+xml", role: "team-badges" },
  "Content Pack POC"
);

if (!process.exitCode) {
  console.log("POC plugin chain validation passed.");
}
