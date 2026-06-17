#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const visualPackDir = resolve(rootDir, "poc-visual-pack");
const contentPackDir = resolve(rootDir, "poc-content-pack");
const visualPackEntry = resolve(visualPackDir, "dist/extension/index.js");
const visualPackSource = resolve(visualPackDir, "src/extension/index.ts");
const contentTarget = "bakingrl.poc-visual-pack/visual-pack.content";
const serviceId = "visualPack";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function requireFreshBuild() {
  if (!existsSync(visualPackEntry)) {
    fail("Missing poc-visual-pack dist entry. Run npm run build before npm run validate:runtime-poc.");
  }
  if (statSync(visualPackEntry).mtimeMs < statSync(visualPackSource).mtimeMs) {
    fail("poc-visual-pack dist entry is older than source. Run npm run build before npm run validate:runtime-poc.");
  }
}

function resourceReference(packageId, resourceId) {
  return `${packageId}/${resourceId}`;
}

function createContentCatalog() {
  const manifest = readJson(resolve(contentPackDir, "bakingrl.plugin.json"));
  const packageId = manifest.id;
  const contributions = (manifest.contributes?.contributions ?? []).map((contribution) => ({
    ...contribution,
    packageId,
    reference: resourceReference(packageId, contribution.id)
  }));
  const resources = (manifest.contributes?.resources ?? []).map((resource) => ({
    ...resource,
    packageId,
    reference: resourceReference(packageId, resource.id),
    public: resource.visibility === "public"
  }));

  resources.push({
    id: "privateFixture",
    packageId,
    reference: resourceReference(packageId, "privateFixture"),
    path: "resources/overlay-content.json",
    type: "application/json",
    visibility: "private",
    public: false,
    metadata: {
      role: "private-fixture"
    }
  });

  return {
    packageId,
    contributions,
    resources
  };
}

function createHost(catalog) {
  const listCalls = [];
  const readJsonCalls = [];
  const readTextCalls = [];

  function findResource(ref) {
    const resource = catalog.resources.find((candidate) => candidate.reference === ref);
    if (!resource) throw new Error(`Unknown resource ref: ${ref}`);
    if (resource.visibility !== "public") throw new Error(`Private resource must not be read cross-package: ${ref}`);
    return resource;
  }

  return {
    listCalls,
    readJsonCalls,
    readTextCalls,
    extensions: {
      async contributions(target) {
        if (target !== contentTarget) return [];
        return catalog.contributions.filter((contribution) => contribution.target === target);
      }
    },
    resources: {
      async list(filter) {
        listCalls.push({ ...filter });
        if (filter?.packageId !== catalog.packageId) {
          throw new Error("Runtime POC smoke expects resources.list to scope by content package id.");
        }
        if (filter.visibility !== "public") {
          throw new Error("Runtime POC smoke expects resources.list to request public resources.");
        }
        if (typeof filter.type !== "string" || filter.type.length === 0) {
          throw new Error("Runtime POC smoke expects resources.list to filter by resource type.");
        }
        return catalog.resources.filter(
          (resource) =>
            resource.packageId === filter.packageId &&
            resource.type === filter.type &&
            resource.visibility === filter.visibility
        );
      },
      async readJson(ref, path) {
        readJsonCalls.push({ ref, path: path ?? null });
        const resource = findResource(ref);
        assert.equal(resource.type, "application/json");
        const resourcePath = path ?? resource.path;
        assert.equal(typeof resourcePath, "string");
        return readJson(resolve(contentPackDir, resourcePath));
      },
      async readText(ref, path) {
        readTextCalls.push({ ref, path: path ?? null });
        const resource = findResource(ref);
        assert.equal(resource.type, "image/svg+xml");
        assert.equal(typeof path, "string");
        assert.ok(resource.paths.includes(path), `Unexpected resource path ${path}`);
        return readFileText(resolve(contentPackDir, path));
      }
    }
  };
}

function readFileText(path) {
  return readFileSync(path, "utf8");
}

function createRuntimeContext(overrides = {}) {
  const registeredServices = new Map();
  const subscriptions = [];
  const diagnostics = [];

  return {
    id: "runtime-poc-smoke",
    packageId: "bakingrl.poc-visual-pack",
    mode: "test",
    subscriptions,
    registeredServices,
    services: {
      register(id, methods) {
        registeredServices.set(id, methods);
        return {
          dispose() {
            registeredServices.delete(id);
          }
        };
      },
      async call() {
        throw new Error("Service calls are not used by the runtime POC smoke.");
      }
    },
    settings: {
      get() {
        return undefined;
      },
      all() {
        return {};
      }
    },
    telemetryHub: {
      subscribe() {
        return () => {};
      },
      publish() {},
      snapshot() {
        return null;
      },
      getSnapshot() {
        return null;
      }
    },
    state: {
      async get() {
        return null;
      },
      async set() {}
    },
    registry: {
      async get() {
        return null;
      }
    },
    logger: {
      trace() {},
      debug() {},
      log() {},
      info() {},
      warn() {},
      error() {}
    },
    diagnostics: {
      diagnostics,
      log(message, data) {
        diagnostics.push({ severity: "info", message, data });
      },
      info(message, data) {
        diagnostics.push({ severity: "info", message, data });
      },
      warn(message, data) {
        diagnostics.push({ severity: "warning", message, data });
      },
      error(message, data) {
        diagnostics.push({ severity: "error", message, data });
      }
    },
    ...overrides
  };
}

async function loadVisualPackExtension() {
  requireFreshBuild();
  const href = `${pathToFileURL(visualPackEntry).href}?mtime=${statSync(visualPackEntry).mtimeMs}`;
  const module = await import(href);
  return {
    activate: module.activate ?? module.default?.activate,
    deactivate: module.deactivate ?? module.default?.deactivate
  };
}

async function activateService(extension, overrides) {
  const context = createRuntimeContext(overrides);
  await extension.activate(context);
  const service = context.registeredServices.get(serviceId);
  assert.ok(service, "visualPack service should be registered.");
  return {
    context,
    service
  };
}

async function assertMissingApiFails(extension, overrides, expectedMessage) {
  const { service } = await activateService(extension, overrides);
  await assert.rejects(() => service.content(), expectedMessage);
  await extension.deactivate();
}

const catalog = createContentCatalog();
const host = createHost(catalog);
const extension = await loadVisualPackExtension();

if (typeof extension.activate !== "function" || typeof extension.deactivate !== "function") {
  fail("POC Visual Pack extension entry must export activate and deactivate.");
}

const { service } = await activateService(extension, {
  extensions: host.extensions,
  resources: host.resources
});

const content = await service.content();
assert.equal(content.available, true);
assert.equal(content.target, contentTarget);
assert.equal(content.summary.contributionCount, 1);
assert.equal(content.summary.resourceCount, 2);
assert.equal(content.summary.jsonResourceCount, 1);
assert.equal(content.summary.textResourceCount, 2);
assert.equal(content.summary.title, "Demo Content Pack");
assert.deepEqual(content.summary.messages, [
  "Content Pack is active",
  "Resources are served by the host",
  "Visual Pack consumes this through a contribution chain"
]);
assert.deepEqual(content.summary.badgePaths.sort(), [
  "resources/badges/blue.svg",
  "resources/badges/orange.svg"
]);

const snapshot = await service.snapshot();
assert.equal(snapshot.overlayTarget, "bakingrl.poc-overlay-studio/overlay-studio.visual");
assert.equal(snapshot.content.summary.title, "Demo Content Pack");
assert.equal(snapshot.resources.length, 2);

const rendered = await service.renderWidget({ source: "runtime-poc-smoke" });
assert.equal(rendered.ok, true);
assert.equal(rendered.render.title, "Demo Content Pack");
assert.equal(rendered.content.summary.textResourceCount, 2);

for (const type of ["application/json", "image/svg+xml"]) {
  assert.ok(
    host.listCalls.some(
      (call) => call.packageId === catalog.packageId && call.type === type && call.visibility === "public"
    ),
    `resources.list should be called for ${type} public content resources.`
  );
}
assert.ok(
  host.readJsonCalls.some((call) => call.ref === resourceReference(catalog.packageId, "overlayContent")),
  "resources.readJson should read the overlayContent JSON resource."
);
for (const path of ["resources/badges/blue.svg", "resources/badges/orange.svg"]) {
  assert.ok(
    host.readTextCalls.some((call) => call.ref === resourceReference(catalog.packageId, "badgeSvgs") && call.path === path),
    `resources.readText should read ${path}.`
  );
}

await extension.deactivate();
await assertMissingApiFails(extension, { resources: host.resources }, /requires host extensions\.contributions/);
await assertMissingApiFails(extension, { extensions: host.extensions }, /requires host resources\.list/);

console.log("Runtime POC smoke passed.");
