#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pocDirs = [
  "poc-simple-node",
  "poc-webview-settings",
  "poc-sidecar",
  "poc-overlay-studio",
  "poc-visual-pack",
  "poc-content-pack"
];
const simplePackageId = "bakingrl.poc-simple-node";
const webviewSettingsPackageId = "bakingrl.poc-webview-settings";
const sidecarPackageId = "bakingrl.poc-sidecar";
const overlayPackageId = "bakingrl.poc-overlay-studio";
const visualPackageId = "bakingrl.poc-visual-pack";
const contentPackageId = "bakingrl.poc-content-pack";
const webviewSettingsServiceRef = `${webviewSettingsPackageId}/pocWebviewSettings`;
const sidecarServiceRef = `${sidecarPackageId}/pocSidecar`;
const nativeSidecarServiceRef = `${sidecarPackageId}/pocSidecarNative`;
const overlayTarget = `${overlayPackageId}/overlay-studio.visual`;
const contentTarget = `${visualPackageId}/visual-pack.content`;
const overlayServiceRef = `${overlayPackageId}/overlayStudio`;
const visualServiceRef = `${visualPackageId}/visualPack`;
const textResourceTypes = new Set(["application/javascript", "image/svg+xml", "text/css", "text/html"]);
const initialTelemetryFrame = {
  Event: "UpdateState",
  Data: {
    MatchGuid: "runtime-poc-host-snapshot",
    Players: [],
    Game: {
      Teams: [
        {
          Name: "Blue",
          TeamNum: 0,
          Score: 2,
          ColorPrimary: "#2563eb",
          ColorSecondary: "#93c5fd"
        },
        {
          Name: "Orange",
          TeamNum: 1,
          Score: 1,
          ColorPrimary: "#f97316",
          ColorSecondary: "#fed7aa"
        }
      ],
      TimeSeconds: 123,
      bOvertime: false,
      Frame: 42,
      Elapsed: 12.3,
      Ball: {
        Speed: 640,
        TeamNum: 0
      },
      bReplay: false,
      bHasWinner: false,
      Winner: "",
      Arena: "DFH Stadium",
      bHasTarget: false,
      Target: null
    }
  }
};

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

function updateStateFrame(matchGuid, blueScore, orangeScore) {
  const frame = cloneJson(initialTelemetryFrame);
  frame.Data.MatchGuid = matchGuid;
  frame.Data.Game.Teams[0].Score = blueScore;
  frame.Data.Game.Teams[1].Score = orangeScore;
  return frame;
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

function requireFreshWebviewBuild(pkg, webviewId) {
  const webview = pkg.manifest.contributes?.webviews?.find((item) => item.id === webviewId);
  if (!webview?.entry) fail(`${pkg.dir} does not declare webview ${webviewId}.`);

  const entryPath = resolve(pkg.packageDir, webview.entry);
  const sourcePath = resolve(pkg.packageDir, `src/webviews/${webviewId}/index.ts`);
  if (!existsSync(entryPath)) {
    fail(`Missing ${pkg.dir} ${webviewId} webview dist entry. Run npm run build before npm run validate:runtime-poc.`);
  }
  if (existsSync(sourcePath) && statSync(entryPath).mtimeMs < statSync(sourcePath).mtimeMs) {
    fail(`${pkg.dir} ${webviewId} webview dist entry is older than source. Run npm run build before npm run validate:runtime-poc.`);
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

function createManifestRuntimeHost(
  packageList,
  initialActivePackageIds = packageList.map((pkg) => pkg.id),
  latestTelemetryEvent = null,
  initialPackageSettings = {}
) {
  const packages = new Map(packageList.map((pkg) => [pkg.id, pkg]));
  const activePackageIds = new Set(initialActivePackageIds);
  const registeredServices = new Map();
  const packageSettings = new Map(Object.entries(cloneJson(initialPackageSettings)));
  const settingSubscribers = new Map();
  const sidecarServices = new Map();
  const sidecarStates = new Map();
  const calls = {
    contributions: [],
    pluginsList: [],
    resourceList: [],
    readJson: [],
    readText: [],
    serviceCalls: [],
    webviewOpens: [],
    webviewCloses: [],
    sidecarStarts: [],
    sidecarStops: [],
    sidecarRestarts: [],
    sidecarCalls: []
  };

  for (const pkg of packageList) {
    const sidecarIds = new Set((pkg.manifest.runtime?.sidecars ?? []).map((sidecar) => sidecar.id));
    for (const service of pkg.manifest.contributes?.services ?? []) {
      const sidecarName = typeof service.runtime === "string" ? service.runtime.replace(/^sidecar:/, "") : "";
      if (!service.runtime?.startsWith?.("sidecar:") || !sidecarIds.has(sidecarName)) continue;
      sidecarServices.set(`${pkg.id}/${service.id}`, {
        packageId: pkg.id,
        sidecarName,
        methods: service.methods ?? []
      });
    }
  }

  function setActive(packageIds) {
    activePackageIds.clear();
    for (const packageId of packageIds) activePackageIds.add(packageId);
  }

  function settingsFor(packageId) {
    if (!packageSettings.has(packageId)) packageSettings.set(packageId, {});
    return packageSettings.get(packageId);
  }

  function setPackageSettings(packageId, values) {
    const next = { ...settingsFor(packageId), ...cloneJson(values ?? {}) };
    packageSettings.set(packageId, next);
    for (const callback of settingSubscribers.get(packageId) ?? []) void callback(cloneJson(next));
    return cloneJson(next);
  }

  function subscribePackageSettings(packageId, callback) {
    if (!settingSubscribers.has(packageId)) settingSubscribers.set(packageId, new Set());
    settingSubscribers.get(packageId).add(callback);
    return () => settingSubscribers.get(packageId)?.delete(callback);
  }

  function declaredWebviews(packageId) {
    return Object.fromEntries(
      (packages.get(packageId)?.manifest.contributes?.webviews ?? []).map((webview) => [webview.id, cloneJson(webview)])
    );
  }

  async function openWebview(packageId, webviewId, options = {}) {
    if (!activePackageIds.has(packageId)) throw new Error(`Webview package is inactive: ${packageId}`);
    const webview = packages.get(packageId)?.manifest.contributes?.webviews?.find((candidate) => candidate.id === webviewId);
    if (!webview) throw new Error(`Unknown webview: ${packageId}/${webviewId}`);
    const call = {
      packageId,
      webviewId,
      options: cloneJson(options),
      title: webview.title ?? webview.id,
      entry: webview.entry
    };
    calls.webviewOpens.push(call);
    return cloneJson(call);
  }

  async function closeWebview(packageId, webviewId) {
    const call = { packageId, webviewId };
    calls.webviewCloses.push(call);
    return cloneJson(call);
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

  function sidecarRef(packageId, sidecarName) {
    return `${packageId}/${sidecarName}`;
  }

  function sidecarState(packageId, sidecarName) {
    const ref = sidecarRef(packageId, sidecarName);
    if (!sidecarStates.has(ref)) {
      sidecarStates.set(ref, {
        running: false,
        crashCount: 0,
        lastExitCode: null
      });
    }
    return sidecarStates.get(ref);
  }

  function requireDeclaredSidecar(packageId, sidecarName) {
    if (!activePackageIds.has(packageId)) throw new Error(`Sidecar package is inactive: ${packageId}`);
    const pkg = packages.get(packageId);
    const sidecar = pkg?.manifest.runtime?.sidecars?.find((candidate) => candidate.id === sidecarName);
    if (!pkg || !sidecar) throw new Error(`Unknown sidecar runtime: ${sidecarRef(packageId, sidecarName)}`);
    return { pkg, sidecar };
  }

  async function startSidecar(packageId, sidecarName) {
    requireDeclaredSidecar(packageId, sidecarName);
    calls.sidecarStarts.push({ packageId, sidecarName });
    const state = sidecarState(packageId, sidecarName);
    state.running = true;
    state.lastExitCode = null;
    return {
      ok: true,
      ref: sidecarRef(packageId, sidecarName)
    };
  }

  async function stopSidecar(packageId, sidecarName) {
    requireDeclaredSidecar(packageId, sidecarName);
    calls.sidecarStops.push({ packageId, sidecarName });
    const state = sidecarState(packageId, sidecarName);
    const wasRunning = state.running;
    state.running = false;
    state.lastExitCode = 0;
    return {
      ok: true,
      stopped: wasRunning,
      ref: sidecarRef(packageId, sidecarName)
    };
  }

  async function restartSidecar(packageId, sidecarName) {
    requireDeclaredSidecar(packageId, sidecarName);
    calls.sidecarRestarts.push({ packageId, sidecarName });
    const state = sidecarState(packageId, sidecarName);
    state.running = true;
    state.lastExitCode = null;
    return {
      ok: true,
      restarted: true,
      ref: sidecarRef(packageId, sidecarName)
    };
  }

  async function callSidecar(packageId, sidecarName, method, params = {}) {
    requireDeclaredSidecar(packageId, sidecarName);
    const state = sidecarState(packageId, sidecarName);
    const ref = sidecarRef(packageId, sidecarName);
    calls.sidecarCalls.push({ packageId, sidecarName, method, params });
    if (!state.running) throw new Error(`Sidecar runtime '${ref}' is not running.`);

    if (method === "ping") {
      return {
        ok: true,
        method: "ping",
        ref,
        echo: params
      };
    }
    if (method === "health") {
      return {
        ok: true,
        status: "healthy",
        ref,
        checkedAtMs: 123456
      };
    }
    if (method === "crash") {
      state.running = false;
      state.lastExitCode = 42;
      state.crashCount += 1;
      return {
        ok: false,
        status: "crashing",
        ref,
        exitCode: 42
      };
    }
    throw new Error(`Unknown sidecar method: ${ref}.${method}`);
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
    assert.ok(textResourceTypes.has(resource.type), `Unsupported text resource type: ${resource.type}`);
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
    if (!service) {
      const sidecarService = sidecarServices.get(ref);
      if (!sidecarService) throw new Error(`Unknown service ref: ${ref}`);
      if (!activePackageIds.has(sidecarService.packageId)) throw new Error(`Service package is inactive: ${ref}`);
      if (!sidecarService.methods.includes(method)) throw new Error(`Unknown service method: ${ref}.${method}`);
      return callSidecar(sidecarService.packageId, sidecarService.sidecarName, method, input ?? {});
    }
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
      webviews: {
        declared: declaredWebviews(packageId),
        open(id, options) {
          return openWebview(packageId, id, options ?? {});
        },
        close(id) {
          return closeWebview(packageId, id);
        }
      },
      sidecars: {
        declared: (packages.get(packageId)?.manifest.runtime?.sidecars ?? []).map((sidecar) => sidecar.id),
        start(name) {
          return startSidecar(packageId, name);
        },
        stop(name) {
          return stopSidecar(packageId, name);
        },
        restart(name) {
          return restartSidecar(packageId, name);
        },
        call(name, method, params) {
          return callSidecar(packageId, name, method, params ?? {});
        }
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
          if (textResourceTypes.has(resource.type)) return readPublicText(ref, path);
          throw new Error(`Unsupported runtime POC resource type: ${resource.type}`);
        },
        readJson: readPublicJson,
        readText: readPublicText
      },
      settings: {
        get(key) {
          return settingsFor(packageId)[key];
        },
        all() {
          return cloneJson(settingsFor(packageId));
        }
      },
      telemetryHub: {
        subscribe() {
          return () => {};
        },
        publish() {},
        snapshot() {
          return latestTelemetryEvent;
        },
        getSnapshot() {
          return latestTelemetryEvent;
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
    listResources,
    settingsFor(packageId) {
      return cloneJson(settingsFor(packageId));
    },
    setPackageSettings,
    subscribePackageSettings,
    sidecarState(packageId, sidecarName) {
      return { ...sidecarState(packageId, sidecarName) };
    }
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

async function loadWebview(pkg, webviewId) {
  const entryPath = requireFreshWebviewBuild(pkg, webviewId);
  const href = `${pathToFileURL(entryPath).href}?mtime=${statSync(entryPath).mtimeMs}`;
  const module = await import(href);
  const webview = module.default ?? module;
  if (typeof webview.mount !== "function") {
    fail(`${pkg.dir} ${webviewId} webview must export mount.`);
  }
  return webview;
}

function installFakeDocument() {
  const previousDocument = globalThis.document;
  const nodesById = new Map();
  globalThis.document = {
    getElementById(id) {
      return nodesById.get(id) ?? null;
    },
    createElement(tagName) {
      return {
        tagName: String(tagName).toUpperCase(),
        id: "",
        textContent: "",
        style: {},
        setAttribute() {},
        append() {}
      };
    },
    head: {
      append(node) {
        if (node?.id) nodesById.set(node.id, node);
      }
    }
  };
  return () => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  };
}

function createFakeRoot() {
  let submitHandler = null;
  const inputs = new Map();
  return {
    innerHTML: "",
    append(node) {
      this.innerHTML += node?.innerHTML ?? node?.textContent ?? "";
    },
    replaceChildren(...nodes) {
      this.innerHTML = nodes.map((node) => node?.innerHTML ?? node?.textContent ?? "").join("");
    },
    querySelector(selector) {
      if (selector === "form") {
        return {
          addEventListener(eventName, handler) {
            if (eventName === "submit") submitHandler = handler;
          }
        };
      }
      if (typeof selector === "string" && selector.startsWith("#")) {
        const id = selector.slice(1);
        if (!inputs.has(id)) inputs.set(id, {});
        return inputs.get(id);
      }
      return null;
    },
    submitForm(values) {
      for (const [key, value] of Object.entries(values)) {
        if (!inputs.has(key)) inputs.set(key, {});
        const input = inputs.get(key);
        if (typeof value === "boolean") input.checked = value;
        else input.value = String(value);
      }
      submitHandler?.({ preventDefault() {} });
    }
  };
}

function createWebviewTelemetryHarness(initialFrame) {
  let latest = initialFrame;
  const subscriptions = new Set();

  function publishFrame(frame) {
    latest = frame;
    for (const subscription of subscriptions) {
      if (subscription.eventName === frame.Event) void subscription.callback(frame);
    }
  }

  return {
    hub: {
      subscribe(eventName, callback) {
        const subscription = { eventName, callback };
        subscriptions.add(subscription);
        return () => subscriptions.delete(subscription);
      },
      publish(eventName, payload) {
        publishFrame({ Event: eventName, Data: payload ?? null });
      },
      snapshot() {
        return latest;
      },
      getSnapshot() {
        return latest;
      }
    },
    publishFrame
  };
}

async function assertOverlayStudioWebviewTelemetry(pkg) {
  const restoreDocument = installFakeDocument();
  try {
    const webview = await loadWebview(pkg, "studio");
    const root = createFakeRoot();
    const telemetry = createWebviewTelemetryHarness(initialTelemetryFrame);
    const cleanup = await webview.mount({
      root,
      packageId: overlayPackageId,
      webviewId: "studio",
      settings: {
        async get() {
          return {};
        },
        async save(values) {
          return values;
        },
        subscribe() {
          return () => {};
        }
      },
      telemetryHub: telemetry.hub,
      dimensions: {
        width: 1040,
        height: 720
      },
      mode: "runtime"
    });

    assert.ok(root.innerHTML.includes("runtime-poc-host-snapshot"), "webview should render the initial telemetry snapshot.");
    assert.ok(root.innerHTML.includes("<dd>snapshot</dd>"), "webview should label the initial telemetry source.");
    assert.ok(root.innerHTML.includes("<dd>2-1</dd>"), "webview should render the initial telemetry score.");

    telemetry.publishFrame(updateStateFrame("runtime-poc-webview-event", 5, 4));

    assert.ok(root.innerHTML.includes("runtime-poc-webview-event"), "webview should render subscribed telemetry events.");
    assert.ok(root.innerHTML.includes("<dd>event</dd>"), "webview should label subscribed telemetry as events.");
    assert.ok(root.innerHTML.includes("<dd>5-4</dd>"), "webview should render the subscribed telemetry score.");

    if (typeof cleanup === "function") cleanup();
    assert.equal(root.innerHTML, "");
  } finally {
    restoreDocument();
  }
}

async function assertWebviewSettingsModule(pkg, host) {
  const restoreDocument = installFakeDocument();
  try {
    const webview = await loadWebview(pkg, "settings");
    const root = createFakeRoot();
    let currentSettings = host.settingsFor(webviewSettingsPackageId);
    const cleanup = await webview.mount({
      root,
      packageId: webviewSettingsPackageId,
      webviewId: "settings",
      settings: {
        async get() {
          return currentSettings;
        },
        async save(values) {
          currentSettings = host.setPackageSettings(webviewSettingsPackageId, values);
          return currentSettings;
        },
        subscribe(callback) {
          return host.subscribePackageSettings(webviewSettingsPackageId, (settings) => {
            currentSettings = settings;
            void callback(settings);
          });
        }
      },
      telemetryHub: createWebviewTelemetryHarness(initialTelemetryFrame).hub,
      dimensions: {
        width: 720,
        height: 520
      },
      mode: "runtime"
    });

    assert.ok(root.innerHTML.includes("POC Webview Settings"), "settings webview should render.");
    assert.ok(root.innerHTML.includes("Initial Settings"), "settings webview should render host-provided settings.");

    root.submitForm({
      enabled: false,
      displayName: "Saved Through Bridge",
      accentColor: "#ef4444",
      refreshSeconds: 9
    });
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(host.settingsFor(webviewSettingsPackageId).enabled, false);
    assert.equal(host.settingsFor(webviewSettingsPackageId).displayName, "Saved Through Bridge");
    assert.ok(root.innerHTML.includes("Saved through host settings bridge."), "settings webview should confirm host save.");
    assert.ok(root.innerHTML.includes("Saved Through Bridge"), "settings webview should re-render saved settings.");

    host.setPackageSettings(webviewSettingsPackageId, {
      enabled: true,
      displayName: "Subscribed Settings",
      accentColor: "#2563eb",
      refreshSeconds: 12
    });
    await Promise.resolve();

    assert.ok(root.innerHTML.includes("Updated from host settings."), "settings webview should react to host setting updates.");
    assert.ok(root.innerHTML.includes("Subscribed Settings"), "settings webview should render subscribed host updates.");

    if (typeof cleanup === "function") cleanup();
    assert.equal(root.innerHTML, "");
  } finally {
    restoreDocument();
  }
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
  assert.equal(contribution.visual, undefined);
  assert.equal(contribution.service, "visualPack");
  assert.deepEqual(contribution.resources, ["demoWidgetModule", "widgetPreset"]);
  assert.equal(contribution.metadata.contentTarget, contentTarget);
  assert.deepEqual(contribution.metadata.defaultSize, [380, 160]);
  assert.equal(contribution.metadata.remoteCompatible, true);
  assert.equal(contribution.metadata.renderer.kind, "resource-module");
  assert.equal(contribution.metadata.renderer.resource, "demoWidgetModule");
  assert.equal(contribution.metadata.renderer.moduleFormat, "esm");
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
for (const pkg of packageList) {
  assert.equal(
    (pkg.manifest.contributes?.visuals ?? []).length,
    0,
    `${pkg.dir} should not declare host-owned contributes.visuals in the POC chain.`
  );
  for (const contribution of pkg.manifest.contributes?.contributions ?? []) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(contribution, "visual"),
      false,
      `${pkg.dir}/${contribution.id} should not declare host-owned contribution.visual.`
    );
  }
}
const packages = new Map(packageList.map((pkg) => [pkg.id, pkg]));
const simplePackage = requirePackage(packages, simplePackageId);
const webviewSettingsPackage = requirePackage(packages, webviewSettingsPackageId);
const sidecarPackage = requirePackage(packages, sidecarPackageId);
const overlayPackage = requirePackage(packages, overlayPackageId);
const visualPackage = requirePackage(packages, visualPackageId);
requirePackage(packages, contentPackageId);

const host = createManifestRuntimeHost(packageList, undefined, initialTelemetryFrame, {
  [webviewSettingsPackageId]: {
    enabled: true,
    displayName: "Initial Settings",
    accentColor: "#16a34a",
    refreshSeconds: 5
  }
});
const simpleExtension = await loadExtension(simplePackage);
const webviewSettingsExtension = await loadExtension(webviewSettingsPackage);
const sidecarExtension = await loadExtension(sidecarPackage);
const overlayExtension = await loadExtension(overlayPackage);
const visualExtension = await loadExtension(visualPackage);
let visualExtensionActive = false;
let webviewSettingsExtensionActive = false;
let sidecarExtensionActive = false;

try {
  await assertOverlayStudioWebviewTelemetry(overlayPackage);
  await assertWebviewSettingsModule(webviewSettingsPackage, host);

  await simpleExtension.activate(host.createRuntimeContext(simplePackageId));
  await webviewSettingsExtension.activate(host.createRuntimeContext(webviewSettingsPackageId));
  webviewSettingsExtensionActive = true;
  await sidecarExtension.activate(host.createRuntimeContext(sidecarPackageId));
  sidecarExtensionActive = true;
  await overlayExtension.activate(host.createRuntimeContext(overlayPackageId));
  await visualExtension.activate(host.createRuntimeContext(visualPackageId));
  visualExtensionActive = true;

  host.setActive([
    simplePackageId,
    webviewSettingsPackageId,
    sidecarPackageId,
    overlayPackageId,
    visualPackageId,
    contentPackageId
  ]);

  const overlayPreviewModule = await host
    .createRuntimeContext(overlayPackageId)
    .resources.readText(resourceReference(overlayPackageId, "overlayPreviewModule"));
  assert.ok(
    overlayPreviewModule.includes("Overlay Studio POC"),
    "Overlay Studio preview module should be served as a public resource."
  );
  const demoWidgetModule = await host
    .createRuntimeContext(visualPackageId)
    .resources.readText(resourceReference(visualPackageId, "demoWidgetModule"));
  assert.ok(
    demoWidgetModule.includes("Visual Pack Widget"),
    "Visual Pack widget module should be served as a public resource."
  );

  const simpleSnapshot = await host.callService(`${simplePackageId}/pocSimpleNode`, "snapshot");
  assert.equal(simpleSnapshot.source, "telemetry");
  assert.equal(simpleSnapshot.frame.Data.MatchGuid, "runtime-poc-host-snapshot");

  const webviewSettingsSnapshot = await host.callService(webviewSettingsServiceRef, "settingsSnapshot");
  assert.equal(webviewSettingsSnapshot.packageId, webviewSettingsPackageId);
  assert.equal(webviewSettingsSnapshot.settings.displayName, "Subscribed Settings");

  const webviewOpen = await host.callService(webviewSettingsServiceRef, "openSettings", { source: "runtime-poc-smoke" });
  assert.equal(webviewOpen.ok, true);
  assert.equal(webviewOpen.webviewId, "settings");
  assert.equal(webviewOpen.result.packageId, webviewSettingsPackageId);
  assert.equal(webviewOpen.result.webviewId, "settings");
  assert.deepEqual(webviewOpen.result.options, { source: "runtime-poc-smoke" });
  assert.ok(
    host.calls.webviewOpens.some(
      (call) => call.packageId === webviewSettingsPackageId && call.webviewId === "settings"
    ),
    "POC webview settings should open its declared webview through the host."
  );

  const sidecarPing = await host.callService(sidecarServiceRef, "ping", { source: "runtime-poc-smoke" });
  assert.equal(sidecarPing.ok, true);
  assert.equal(sidecarPing.method, "ping");
  assert.equal(sidecarPing.ref, `${sidecarPackageId}/worker`);
  assert.deepEqual(sidecarPing.echo, { source: "runtime-poc-smoke" });

  const sidecarHealth = await host.callService(sidecarServiceRef, "health");
  assert.equal(sidecarHealth.status, "healthy");
  assert.equal(host.sidecarState(sidecarPackageId, "worker").running, true);

  const nativeSidecarHealth = await host.callService(nativeSidecarServiceRef, "health");
  assert.equal(nativeSidecarHealth.status, "healthy");

  const sidecarCrash = await host.callService(sidecarServiceRef, "crash");
  assert.equal(sidecarCrash.status, "crashing");
  assert.equal(sidecarCrash.exitCode, 42);
  assert.equal(host.sidecarState(sidecarPackageId, "worker").running, false);
  assert.equal(host.sidecarState(sidecarPackageId, "worker").crashCount, 1);
  await assert.rejects(() => host.callService(nativeSidecarServiceRef, "health"), /is not running/);

  const sidecarRestartPing = await host.callService(sidecarServiceRef, "ping", { afterCrash: true });
  assert.equal(sidecarRestartPing.ok, true);
  assert.deepEqual(sidecarRestartPing.echo, { afterCrash: true });
  assert.ok(
    host.calls.sidecarStarts.filter((call) => call.packageId === sidecarPackageId && call.sidecarName === "worker").length >= 2,
    "POC sidecar service should start the worker before calls, including after a crash."
  );
  assert.ok(
    host.calls.sidecarCalls.some(
      (call) => call.packageId === sidecarPackageId && call.sidecarName === "worker" && call.method === "crash"
    ),
    "POC sidecar crash path should be exercised through the sidecar controller."
  );

  const overlaySnapshot = await host.callService(overlayServiceRef, "snapshot");
  assert.equal(overlaySnapshot.source, "telemetry");
  assert.equal(overlaySnapshot.score.matchGuid, "runtime-poc-host-snapshot");
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
  if (sidecarExtensionActive) await sidecarExtension.deactivate();
  if (webviewSettingsExtensionActive) await webviewSettingsExtension.deactivate();
  await simpleExtension.deactivate();
}

await assertMissingApiFails(visualExtension, { resources: host.createRuntimeContext(visualPackageId).resources }, /requires host extensions\.contributions/);
await assertMissingApiFails(visualExtension, { extensions: host.createRuntimeContext(visualPackageId).extensions }, /requires host resources\.list/);

console.log("Runtime POC smoke passed.");
