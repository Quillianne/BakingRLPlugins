#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pocDirs = ["poc-overlay-studio", "poc-visual-pack", "poc-content-pack"];
const overlayPackageId = "bakingrl.poc-overlay-studio";
const visualPackageId = "bakingrl.poc-visual-pack";
const contentPackageId = "bakingrl.poc-content-pack";
const overlayTarget = `${overlayPackageId}/overlay-studio.visual`;
const contentTarget = `${visualPackageId}/visual-pack.content`;
const overlayServiceRef = `${overlayPackageId}/overlayStudio`;
const visualServiceRef = `${visualPackageId}/visualPack`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readFileText(path) {
  return readFileSync(path, "utf8");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadPackage(dir) {
  const packageDir = resolve(rootDir, dir);
  const manifest = readJson(resolve(packageDir, "bakingrl.plugin.json"));
  return {
    dir,
    packageDir,
    id: manifest.id,
    manifest
  };
}

function requirePackage(packages, packageId) {
  const item = packages.get(packageId);
  if (!item) fail(`Missing POC package: ${packageId}`);
  return item;
}

function requireFreshBuild(pkg) {
  const entry = pkg.manifest.runtime?.node?.entry;
  if (!entry) return null;

  const entryPath = resolve(pkg.packageDir, entry);
  const sourcePath = resolve(pkg.packageDir, "src/extension/index.ts");
  if (!existsSync(entryPath)) {
    fail(`Missing ${pkg.dir} dist entry. Run npm run build before npm run validate:runtime-poc.`);
  }
  if (existsSync(sourcePath) && statSync(entryPath).mtimeMs < statSync(sourcePath).mtimeMs) {
    fail(`${pkg.dir} dist entry is older than source. Run npm run build before npm run validate:runtime-poc.`);
  }
  return entryPath;
}

function splitReference(ref) {
  const [packageId, id] = String(ref ?? "").split("/");
  if (!packageId || !id) return null;
  return { packageId, id };
}

function resourceReference(packageId, resourceId) {
  return `${packageId}/${resourceId}`;
}

function normalizeContribution(pkg, contribution) {
  return {
    ...cloneJson(contribution),
    packageId: pkg.id,
    reference: resourceReference(pkg.id, contribution.id)
  };
}

function normalizeResource(pkg, resource) {
  const visibility = resource.visibility ?? "private";
  return {
    ...cloneJson(resource),
    visibility,
    packageId: pkg.id,
    reference: resourceReference(pkg.id, resource.id),
    public: visibility === "public"
  };
}

function declaredResourcePaths(resource) {
  if (typeof resource.path === "string") return [resource.path];
  if (Array.isArray(resource.paths)) return resource.paths.filter((item) => typeof item === "string");
  return [];
}

function createManifestRuntimeHost(packageList, initialActivePackageIds = packageList.map((pkg) => pkg.id)) {
  const packages = new Map(packageList.map((pkg) => [pkg.id, pkg]));
  const activePackageIds = new Set(initialActivePackageIds);
  const registeredServices = new Map();
  const calls = {
    contributions: [],
    pluginsList: [],
    resourceList: [],
    readJson: [],
    readText: [],
    serviceCalls: []
  };

  function setActive(packageIds) {
    activePackageIds.clear();
    for (const packageId of packageIds) activePackageIds.add(packageId);
  }

  function isTargetActive(target) {
    const parsed = splitReference(target);
    if (!parsed || !activePackageIds.has(parsed.packageId)) return false;
    const targetPackage = packages.get(parsed.packageId);
    return Boolean(targetPackage?.manifest.contributes?.extensionPoints?.some((point) => point.id === parsed.id));
  }

  function listContributions(target) {
    calls.contributions.push({
      target: target ?? null,
      activePackageIds: [...activePackageIds].sort()
    });

    const contributions = [];
    for (const pkg of packageList) {
      if (!activePackageIds.has(pkg.id)) continue;
      for (const contribution of pkg.manifest.contributes?.contributions ?? []) {
        if (target && contribution.target !== target) continue;
        if (!isTargetActive(contribution.target)) continue;
        contributions.push(normalizeContribution(pkg, contribution));
      }
    }
    return contributions;
  }

  function listResources(filter = {}) {
    calls.resourceList.push({ ...filter });

    const resources = [];
    for (const pkg of packageList) {
      if (!activePackageIds.has(pkg.id)) continue;
      for (const resource of pkg.manifest.contributes?.resources ?? []) {
        const normalized = normalizeResource(pkg, resource);
        if (filter.packageId && normalized.packageId !== filter.packageId) continue;
        if (filter.type && normalized.type !== filter.type) continue;
        if (filter.visibility && normalized.visibility !== filter.visibility) continue;
        resources.push(normalized);
      }
    }
    return resources;
  }

  function findPublicResource(ref) {
    const parsed = splitReference(ref);
    if (!parsed) throw new Error(`Invalid resource ref: ${ref}`);
    if (!activePackageIds.has(parsed.packageId)) throw new Error(`Resource package is inactive: ${ref}`);

    const pkg = packages.get(parsed.packageId);
    const resource = pkg?.manifest.contributes?.resources?.find((candidate) => candidate.id === parsed.id);
    if (!pkg || !resource) throw new Error(`Unknown resource ref: ${ref}`);

    const normalized = normalizeResource(pkg, resource);
    if (normalized.visibility !== "public") throw new Error(`Private resource must not be read cross-package: ${ref}`);
    return { pkg, resource: normalized };
  }

  function resolveDeclaredResourcePath(resource, path) {
    const declaredPaths = declaredResourcePaths(resource);
    const resourcePath = path ?? declaredPaths[0];
    assert.equal(typeof resourcePath, "string");
    assert.ok(declaredPaths.includes(resourcePath), `Unexpected resource path ${resourcePath}`);
    return resourcePath;
  }

  async function readPublicJson(ref, path) {
    calls.readJson.push({ ref, path: path ?? null });
    const { pkg, resource } = findPublicResource(ref);
    assert.equal(resource.type, "application/json");
    const resourcePath = resolveDeclaredResourcePath(resource, path);
    return readJson(resolve(pkg.packageDir, resourcePath));
  }

  async function readPublicText(ref, path) {
    calls.readText.push({ ref, path: path ?? null });
    const { pkg, resource } = findPublicResource(ref);
    assert.equal(resource.type, "image/svg+xml");
    const resourcePath = resolveDeclaredResourcePath(resource, path);
    return readFileText(resolve(pkg.packageDir, resourcePath));
  }

  function registerService(packageId, id, methods) {
    const ref = `${packageId}/${id}`;
    const token = Symbol(ref);
    registeredServices.set(ref, { token, packageId, id, methods });
    return {
      dispose() {
        if (registeredServices.get(ref)?.token === token) {
          registeredServices.delete(ref);
        }
      }
    };
  }

  async function callService(ref, method, input) {
    calls.serviceCalls.push({ ref, method, input: input ?? null });
    const service = registeredServices.get(ref);
    if (!service) throw new Error(`Unknown service ref: ${ref}`);
    if (!activePackageIds.has(service.packageId)) throw new Error(`Service package is inactive: ${ref}`);
    const handler = service.methods?.[method];
    if (typeof handler !== "function") throw new Error(`Unknown service method: ${ref}.${method}`);
    return handler(input);
  }

  function createRuntimeContext(packageId) {
    const contextServices = new Map();
    const subscriptions = [];
    const diagnostics = [];

    return {
      id: `runtime-poc-smoke-${packageId}`,
      packageId,
      mode: "test",
      subscriptions,
      registeredServices: contextServices,
      services: {
        register(id, methods) {
          contextServices.set(id, methods);
          const registration = registerService(packageId, id, methods);
          return {
            dispose() {
              contextServices.delete(id);
              registration.dispose();
            }
          };
        },
        call: callService
      },
      extensions: {
        async contributions(target) {
          return listContributions(target);
        },
        async points(filter = {}) {
          return packageList
            .filter((pkg) => activePackageIds.has(pkg.id))
            .flatMap((pkg) =>
              (pkg.manifest.contributes?.extensionPoints ?? [])
                .filter((point) => !filter.packageId || filter.packageId === pkg.id)
                .map((point) => ({
                  ...cloneJson(point),
                  packageId: pkg.id,
                  reference: `${pkg.id}/${point.id}`
                }))
            );
        }
      },
      plugins: {
        async list() {
          calls.pluginsList.push([...activePackageIds].sort());
          return packageList
            .filter((pkg) => activePackageIds.has(pkg.id))
            .map((pkg) => ({
              id: pkg.id,
              name: pkg.manifest.name,
              version: pkg.manifest.version
            }));
        }
      },
      resources: {
        async list(filter) {
          return listResources(filter);
        },
        async read(ref, path) {
          const { resource } = findPublicResource(ref);
          if (resource.type === "application/json") return readPublicJson(ref, path);
          if (resource.type === "image/svg+xml") return readPublicText(ref, path);
          throw new Error(`Unsupported runtime POC resource type: ${resource.type}`);
        },
        readJson: readPublicJson,
        readText: readPublicText
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
      }
    };
  }

  return {
    calls,
    setActive,
    createRuntimeContext,
    callService,
    listContributions,
    listResources
  };
}

function createStandaloneRuntimeContext(packageId, overrides = {}) {
  const registeredServices = new Map();
  const subscriptions = [];
  const diagnostics = [];

  return {
    id: `runtime-poc-smoke-${packageId}`,
    packageId,
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
        throw new Error("Standalone runtime POC smoke does not expose host service calls.");
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

async function loadExtension(pkg) {
  const entryPath = requireFreshBuild(pkg);
  if (!entryPath) fail(`${pkg.dir} does not declare a node runtime entry.`);

  const href = `${pathToFileURL(entryPath).href}?mtime=${statSync(entryPath).mtimeMs}`;
  const module = await import(href);
  const extension = {
    activate: module.activate ?? module.default?.activate,
    deactivate: module.deactivate ?? module.default?.deactivate
  };
  if (typeof extension.activate !== "function" || typeof extension.deactivate !== "function") {
    fail(`${pkg.dir} extension entry must export activate and deactivate.`);
  }
  return extension;
}

async function activateStandaloneService(extension, overrides) {
  const context = createStandaloneRuntimeContext(visualPackageId, overrides);
  await extension.activate(context);
  const service = context.registeredServices.get("visualPack");
  assert.ok(service, "visualPack service should be registered.");
  return { context, service };
}

async function assertMissingApiFails(extension, overrides, expectedMessage) {
  const { service } = await activateStandaloneService(extension, overrides);
  await assert.rejects(() => service.content(), expectedMessage);
  await extension.deactivate();
}

function assertVisualContribution(contribution) {
  assert.equal(contribution.packageId, visualPackageId);
  assert.equal(contribution.reference, `${visualPackageId}/demo-score-widget`);
  assert.equal(contribution.id, "demo-score-widget");
  assert.equal(contribution.target, overlayTarget);
  assert.equal(contribution.visual, "demoWidget");
  assert.equal(contribution.service, "visualPack");
  assert.deepEqual(contribution.resources, ["widgetPreset"]);
  assert.equal(contribution.metadata.contentTarget, contentTarget);
}

function assertContentContribution(contribution) {
  assert.equal(contribution.packageId, contentPackageId);
  assert.equal(contribution.reference, `${contentPackageId}/demo-overlay-content`);
  assert.equal(contribution.id, "demo-overlay-content");
  assert.equal(contribution.target, contentTarget);
  assert.deepEqual(contribution.resources, ["overlayContent", "badgeSvgs"]);
}

function assertContentSummary(content) {
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
}

const packageList = pocDirs.map(loadPackage);
const packages = new Map(packageList.map((pkg) => [pkg.id, pkg]));
const overlayPackage = requirePackage(packages, overlayPackageId);
const visualPackage = requirePackage(packages, visualPackageId);
requirePackage(packages, contentPackageId);

const host = createManifestRuntimeHost(packageList);
const overlayExtension = await loadExtension(overlayPackage);
const visualExtension = await loadExtension(visualPackage);
let visualExtensionActive = false;

try {
  await overlayExtension.activate(host.createRuntimeContext(overlayPackageId));
  await visualExtension.activate(host.createRuntimeContext(visualPackageId));
  visualExtensionActive = true;

  host.setActive([overlayPackageId, visualPackageId, contentPackageId]);

  const overlaySnapshot = await host.callService(overlayServiceRef, "snapshot");
  assert.equal(overlaySnapshot.discovery.available, true);
  assert.equal(overlaySnapshot.discovery.target, overlayTarget);
  assert.equal(overlaySnapshot.discovery.contributions.length, 1);
  assertVisualContribution(overlaySnapshot.discovery.contributions[0]);

  const overlayContributions = await host.callService(overlayServiceRef, "contributions");
  assert.equal(overlayContributions.contributions.length, 1);
  assertVisualContribution(overlayContributions.contributions[0]);

  const overlayRenderState = await host.callService(overlayServiceRef, "renderState");
  assert.equal(overlayRenderState.discovery.contributions.length, 1);
  assert.ok(overlayRenderState.plugins.some((plugin) => plugin.id === contentPackageId));
  assert.ok(overlayRenderState.plugins.some((plugin) => plugin.id === visualPackageId));

  const content = await host.callService(visualServiceRef, "content");
  assertContentSummary(content);
  assert.equal(content.contributions.length, 1);
  assertContentContribution(content.contributions[0]);

  const snapshot = await host.callService(visualServiceRef, "snapshot");
  assert.equal(snapshot.overlayTarget, overlayTarget);
  assertContentSummary(snapshot.content);
  assert.equal(snapshot.resources.length, 2);

  const rendered = await host.callService(visualServiceRef, "renderWidget", { source: "runtime-poc-smoke" });
  assert.equal(rendered.ok, true);
  assert.equal(rendered.render.title, "Demo Content Pack");
  assert.equal(rendered.content.summary.textResourceCount, 2);

  for (const type of ["application/json", "image/svg+xml"]) {
    assert.ok(
      host.calls.resourceList.some(
        (call) => call.packageId === contentPackageId && call.type === type && call.visibility === "public"
      ),
      `resources.list should be called for ${type} public content resources.`
    );
  }
  assert.ok(
    host.calls.readJson.some((call) => call.ref === resourceReference(contentPackageId, "overlayContent")),
    "resources.readJson should read the overlayContent JSON resource by declared ref."
  );
  for (const path of ["resources/badges/blue.svg", "resources/badges/orange.svg"]) {
    assert.ok(
      host.calls.readText.some(
        (call) => call.ref === resourceReference(contentPackageId, "badgeSvgs") && call.path === path
      ),
      `resources.readText should read ${path} by declared ref.`
    );
  }
  assert.ok(
    host.calls.serviceCalls.some((call) => call.ref === overlayServiceRef && call.method === "snapshot"),
    "Overlay Studio snapshot should be exercised through host service calls."
  );
  assert.ok(
    host.calls.serviceCalls.some((call) => call.ref === visualServiceRef && call.method === "content"),
    "Visual Pack content should be exercised through host service calls."
  );

  const resourceReadCount = host.calls.readJson.length + host.calls.readText.length;
  host.setActive([overlayPackageId, visualPackageId]);
  const contentDisabled = await host.callService(visualServiceRef, "content");
  assert.equal(contentDisabled.available, true);
  assert.equal(contentDisabled.contributions.length, 0);
  assert.equal(contentDisabled.summary.contributionCount, 0);
  assert.equal(contentDisabled.summary.resourceCount, 0);
  assert.equal(host.calls.readJson.length + host.calls.readText.length, resourceReadCount);

  host.setActive([overlayPackageId, contentPackageId]);
  const visualDisabledSnapshot = await host.callService(overlayServiceRef, "snapshot");
  assert.equal(visualDisabledSnapshot.discovery.available, true);
  assert.equal(visualDisabledSnapshot.discovery.contributions.length, 0);
  await assert.rejects(() => host.callService(visualServiceRef, "content"), /Service package is inactive/);

  await visualExtension.deactivate();
  visualExtensionActive = false;
  const visualAbsentSnapshot = await host.callService(overlayServiceRef, "snapshot");
  assert.equal(visualAbsentSnapshot.discovery.contributions.length, 0);
} finally {
  if (visualExtensionActive) await visualExtension.deactivate();
  await overlayExtension.deactivate();
}

await assertMissingApiFails(visualExtension, { resources: host.createRuntimeContext(visualPackageId).resources }, /requires host extensions\.contributions/);
await assertMissingApiFails(visualExtension, { extensions: host.createRuntimeContext(visualPackageId).extensions }, /requires host resources\.list/);

console.log("Runtime POC smoke passed.");
