#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const simplePackageId = "bakingrl.poc-simple-node";
const webviewSettingsPackageId = "bakingrl.poc-webview-settings";
const sidecarPackageId = "bakingrl.poc-sidecar";
const overlayPackageId = "bakingrl.poc-overlay-studio";
const visualPackageId = "bakingrl.poc-visual-pack";
const contentPackageId = "bakingrl.poc-content-pack";
const statsPackageId = "bakingrl.stats-extended";
const layoutPackageId = "bakingrl.layout-studio";
const broadcastPackageId = "bakingrl.broadcast-visuals";
const playerStreakPackageId = "com.bakingrl.player-streak";
const dejaVuPackageId = "com.bakingrl.deja-vu";
const obsGatewayPackageId = "bakingrl.obs-gateway";
const rootDir = resolve(process.env.BAKINGRL_POC_ROOT_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const skipFreshnessCheck = process.env.BAKINGRL_POC_SKIP_FRESHNESS === "1";
const pocSpecs = [
  { dir: "poc-simple-node", packageId: simplePackageId },
  { dir: "poc-webview-settings", packageId: webviewSettingsPackageId },
  { dir: "poc-sidecar", packageId: sidecarPackageId },
  { dir: "poc-overlay-studio", packageId: overlayPackageId },
  { dir: "poc-visual-pack", packageId: visualPackageId },
  { dir: "poc-content-pack", packageId: contentPackageId }
];
const productSpecs = [
  { dir: "stats-extended", packageId: statsPackageId },
  { dir: "layout-studio", packageId: layoutPackageId },
  { dir: "broadcast-visuals", packageId: broadcastPackageId },
  { dir: "player-streak", packageId: playerStreakPackageId },
  { dir: "deja-vu", packageId: dejaVuPackageId },
  { dir: "obs-gateway", packageId: obsGatewayPackageId }
];
const webviewSettingsServiceRef = `${webviewSettingsPackageId}/pocWebviewSettings`;
const webviewSettingsCommandRef = `${webviewSettingsPackageId}/openSettings`;
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

function resolvePackageDir(dir, packageId) {
  const workspaceDir = resolve(rootDir, dir);
  if (existsSync(workspaceDir)) return workspaceDir;
  const installedDir = resolve(rootDir, packageId);
  if (existsSync(installedDir)) return installedDir;
  return workspaceDir;
}

function loadPackage({ dir, packageId }) {
  const packageDir = resolvePackageDir(dir, packageId);
  const manifest = readJson(resolve(packageDir, "bakingrl.plugin.json"));
  if (manifest.id !== packageId) fail(`${dir} manifest id must be ${packageId}, got ${manifest.id}.`);
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
  if (!skipFreshnessCheck && existsSync(sourcePath) && statSync(entryPath).mtimeMs < statSync(sourcePath).mtimeMs) {
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
  if (!skipFreshnessCheck && existsSync(sourcePath) && statSync(entryPath).mtimeMs < statSync(sourcePath).mtimeMs) {
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

function normalizePlugin(pkg, callerPackageId) {
  const contributes = pkg.manifest.contributes ?? {};
  const resources = (contributes.resources ?? [])
    .map((resource) => normalizeResource(pkg, resource))
    .filter((resource) => resource.public || resource.packageId === callerPackageId);
  return {
    id: pkg.id,
    name: pkg.manifest.name,
    version: pkg.manifest.version,
    author: pkg.manifest.author ?? null,
    bakingrlApi: pkg.manifest.bakingrlApi ?? null,
    enabled: true,
    active: true,
    dependencies: cloneJson(pkg.manifest.dependencies ?? []),
    runtime: cloneJson(pkg.manifest.runtime ?? null),
    contributes: {
      settings: cloneJson(contributes.settings ?? null),
      services: cloneJson(contributes.services ?? []),
      commands: cloneJson(contributes.commands ?? []),
      extensionPoints: cloneJson(contributes.extensionPoints ?? []),
      contributions: cloneJson(contributes.contributions ?? []),
      resources,
      webviews: cloneJson(contributes.webviews ?? [])
    }
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
  const registeredCommands = new Map();
  const registeredServices = new Map();
  const packageSettings = new Map(Object.entries(cloneJson(initialPackageSettings)));
  const settingSubscribers = new Map();
  const sidecarServices = new Map();
  const sidecarStates = new Map();
  const busSubscribers = new Map();
  const registryValues = new Map();
  const storageValues = new Map();
  const stateValues = new Map();
  const secretValues = new Map();
  const calls = {
    contributions: [],
    pluginsList: [],
    resourceList: [],
    readJson: [],
    readText: [],
    commandCalls: [],
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

  function subscribeBus(eventName, callback) {
    if (!busSubscribers.has(eventName)) busSubscribers.set(eventName, new Set());
    busSubscribers.get(eventName).add(callback);
    return () => busSubscribers.get(eventName)?.delete(callback);
  }

  function emitBus(eventName, payload) {
    const frame = { Event: eventName, Data: cloneJson(payload ?? null) };
    for (const callback of busSubscribers.get(eventName) ?? []) void callback(frame);
  }

  function scopedKey(packageId, key) {
    return `${packageId}:${key}`;
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

  function commandRef(packageId, command) {
    const value = String(command ?? "").trim();
    if (!value) throw new Error("Command id is required.");
    return value.includes("/") ? value : `${packageId}/${value}`;
  }

  function requireDeclaredCommand(packageId, commandId) {
    if (!activePackageIds.has(packageId)) throw new Error(`Command package is inactive: ${packageId}`);
    const command = packages.get(packageId)?.manifest.contributes?.commands?.find((candidate) => candidate.id === commandId);
    if (!command) throw new Error(`Unknown command: ${packageId}/${commandId}`);
    return command;
  }

  function registerCommand(packageId, command, handler) {
    const ref = commandRef(packageId, command);
    const parsed = splitReference(ref);
    if (!parsed || parsed.packageId !== packageId) throw new Error(`Command '${ref}' cannot be registered by ${packageId}`);
    requireDeclaredCommand(parsed.packageId, parsed.id);
    assert.equal(typeof handler, "function", `Command ${ref} handler should be a function.`);
    const token = Symbol(ref);
    registeredCommands.set(ref, { token, packageId, id: parsed.id, handler });
    return {
      dispose() {
        if (registeredCommands.get(ref)?.token === token) {
          registeredCommands.delete(ref);
        }
      }
    };
  }

  async function callCommand(callerPackageId, command, args = []) {
    const ref = commandRef(callerPackageId, command);
    const parsed = splitReference(ref);
    if (!parsed) throw new Error(`Invalid command ref: ${ref}`);
    requireDeclaredCommand(parsed.packageId, parsed.id);
    const caller = packages.get(callerPackageId);
    if (parsed.packageId !== callerPackageId) {
      const dependsOnProvider = (caller?.manifest.dependencies ?? []).some((dependency) => dependency.packageId === parsed.packageId);
      if (!dependsOnProvider) throw new Error(`Command caller ${callerPackageId} does not depend on ${parsed.packageId}`);
    }
    const commandRegistration = registeredCommands.get(ref);
    if (!commandRegistration) throw new Error(`Command runtime is not running: ${ref}`);
    calls.commandCalls.push({ callerPackageId, ref, args: cloneJson(args) });
    return commandRegistration.handler(...args);
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

  function listResources(callerPackageId, filter = {}) {
    calls.resourceList.push({ callerPackageId, ...filter });

    const resources = [];
    for (const pkg of packageList) {
      if (!activePackageIds.has(pkg.id)) continue;
      for (const resource of pkg.manifest.contributes?.resources ?? []) {
        const normalized = normalizeResource(pkg, resource);
        if (normalized.visibility !== "public" && normalized.packageId !== callerPackageId) continue;
        if (filter.packageId && normalized.packageId !== filter.packageId) continue;
        if (filter.type && normalized.type !== filter.type) continue;
        if (filter.visibility && normalized.visibility !== filter.visibility) continue;
        resources.push(normalized);
      }
    }
    return resources;
  }

  function findReadableResource(callerPackageId, ref) {
    const parsed = splitReference(ref);
    if (!parsed) throw new Error(`Invalid resource ref: ${ref}`);
    if (!activePackageIds.has(parsed.packageId)) throw new Error(`Resource package is inactive: ${ref}`);

    const pkg = packages.get(parsed.packageId);
    const resource = pkg?.manifest.contributes?.resources?.find((candidate) => candidate.id === parsed.id);
    if (!pkg || !resource) throw new Error(`Unknown resource ref: ${ref}`);

    const normalized = normalizeResource(pkg, resource);
    if (normalized.visibility !== "public" && parsed.packageId !== callerPackageId) {
      throw new Error(`Private resource must not be read cross-package: ${ref}`);
    }
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
    if (["configure", "updateHostData", "setConnectionState", "snapshot"].includes(method)) {
      return {
        ok: true,
        method,
        ref,
        ...cloneJson(params ?? {})
      };
    }
    throw new Error(`Unknown sidecar method: ${ref}.${method}`);
  }

  async function readResourceJson(callerPackageId, ref, path) {
    calls.readJson.push({ callerPackageId, ref, path: path ?? null });
    const { pkg, resource } = findReadableResource(callerPackageId, ref);
    assert.equal(resource.type, "application/json");
    const resourcePath = resolveDeclaredResourcePath(resource, path);
    return readJson(resolve(pkg.packageDir, resourcePath));
  }

  async function readResourceText(callerPackageId, ref, path) {
    calls.readText.push({ callerPackageId, ref, path: path ?? null });
    const { pkg, resource } = findReadableResource(callerPackageId, ref);
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
    const contextCommands = new Map();
    const contextServices = new Map();
    const subscriptions = [];
    const diagnostics = [];

    return {
      id: `runtime-poc-smoke-${packageId}`,
      packageId,
      mode: "test",
      subscriptions,
      registeredServices: contextServices,
      registeredCommands: contextCommands,
      commands: {
        registerCommand(command, handler) {
          const ref = commandRef(packageId, command);
          contextCommands.set(ref, handler);
          const registration = registerCommand(packageId, command, handler);
          return {
            dispose() {
              contextCommands.delete(ref);
              registration.dispose();
            }
          };
        },
        executeCommand(command, ...args) {
          return callCommand(packageId, command, args);
        }
      },
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
            .map((pkg) => normalizePlugin(pkg, packageId));
        }
      },
      resources: {
        async list(filter) {
          return listResources(packageId, filter);
        },
        async read(ref, path) {
          const { resource } = findReadableResource(packageId, ref);
          if (resource.type === "application/json") return readResourceJson(packageId, ref, path);
          if (textResourceTypes.has(resource.type)) return readResourceText(packageId, ref, path);
          throw new Error(`Unsupported runtime POC resource type: ${resource.type}`);
        },
        readJson(ref, path) {
          return readResourceJson(packageId, ref, path);
        },
        readText(ref, path) {
          return readResourceText(packageId, ref, path);
        }
      },
      settings: {
        get(key) {
          return settingsFor(packageId)[key];
        },
        all() {
          return cloneJson(settingsFor(packageId));
        }
      },
      bus: {
        subscribe(eventName, callback) {
          return subscribeBus(eventName, callback);
        },
        emit(eventName, payload) {
          emitBus(eventName, payload);
        }
      },
      telemetryHub: {
        subscribe(eventName, callback) {
          return subscribeBus(eventName, callback);
        },
        publish(eventName, payload) {
          emitBus(eventName, payload);
        },
        snapshot() {
          return latestTelemetryEvent;
        },
        getSnapshot() {
          return latestTelemetryEvent;
        }
      },
      state: {
        async get(key) {
          return cloneJson(stateValues.get(scopedKey(packageId, key)) ?? null);
        },
        async set(key, value) {
          stateValues.set(scopedKey(packageId, key), cloneJson(value));
        }
      },
      stateHub: {
        async read(key) {
          return cloneJson(stateValues.get(key) ?? null);
        },
        async write(key, value) {
          stateValues.set(key, cloneJson(value));
          return value;
        },
        snapshot() {
          return Object.fromEntries(stateValues);
        },
        getSnapshot() {
          return Object.fromEntries(stateValues);
        }
      },
      registry: {
        async get(key) {
          return cloneJson(registryValues.get(key) ?? null);
        },
        async set(key, value) {
          registryValues.set(key, cloneJson(value));
        },
        async entries() {
          return Object.fromEntries(registryValues);
        }
      },
      storage: {
        async readText(path) {
          const key = scopedKey(packageId, path);
          if (!storageValues.has(key)) throw new Error(`Storage path not found: ${path}`);
          return storageValues.get(key);
        },
        async writeText(path, contents) {
          storageValues.set(scopedKey(packageId, path), String(contents));
        },
        async readJson(path) {
          return JSON.parse(await this.readText(path));
        },
        async writeJson(path, value) {
          await this.writeText(path, JSON.stringify(value));
        },
        async list(prefix = "") {
          const scope = `${packageId}:`;
          return [...storageValues.keys()]
            .filter((key) => key.startsWith(scope))
            .map((key) => key.slice(scope.length))
            .filter((path) => path.startsWith(prefix));
        },
        async delete(path) {
          return storageValues.delete(scopedKey(packageId, path));
        },
        async usage() {
          const paths = await this.list();
          const usedBytes = paths.reduce((total, path) => total + Buffer.byteLength(storageValues.get(scopedKey(packageId, path)) ?? ""), 0);
          return { usedBytes, quotaBytes: 16 * 1024 * 1024 };
        }
      },
      secrets: {
        async get(key) {
          return secretValues.get(scopedKey(packageId, key));
        },
        async configured(key) {
          return secretValues.has(scopedKey(packageId, key));
        }
      },
      assets: {
        url(ref) {
          return `bakingrl-asset://${packageId}/${ref}`;
        }
      },
      telemetry: {
        async event() {
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
    callCommand,
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
  const registeredCommands = new Map();
  const registeredServices = new Map();
  const subscriptions = [];
  const diagnostics = [];

  return {
    id: `runtime-poc-smoke-${packageId}`,
    packageId,
    mode: "test",
    subscriptions,
    registeredCommands,
    registeredServices,
    commands: {
      registerCommand(command, handler) {
        registeredCommands.set(command, handler);
        return {
          dispose() {
            registeredCommands.delete(command);
          }
        };
      },
      async executeCommand() {
        throw new Error("Standalone runtime POC smoke does not expose host command calls.");
      }
    },
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
    const assetUrls = [];
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
      assets: {
        async url(ref) {
          assetUrls.push(ref);
          return `data:image/svg+xml;base64,${Buffer.from(`<svg data-ref="${ref}"></svg>`).toString("base64")}`;
        }
      },
      dimensions: {
        width: 720,
        height: 520
      },
      mode: "runtime"
    });

    assert.ok(root.innerHTML.includes("POC Webview Settings"), "settings webview should render.");
    assert.ok(root.innerHTML.includes("Initial Settings"), "settings webview should render host-provided settings.");
    assert.deepEqual(assetUrls, ["assets/settings-badge.svg"], "settings webview should resolve its package asset.");
    assert.ok(root.innerHTML.includes("data:image/svg+xml;base64,"), "settings webview should render the resolved asset URL.");

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

function assertOverlayRenderState(renderState) {
  assert.equal(renderState.source, "telemetry");
  assert.equal(renderState.score.matchGuid, "runtime-poc-host-snapshot");
  assert.equal(renderState.viewport.width, 1040);
  assert.equal(renderState.viewport.height, 720);
  assert.equal(renderState.discovery.available, true);
  assert.equal(renderState.discovery.target, overlayTarget);
  assert.equal(renderState.discovery.contributions.length, 1);
  assert.equal(renderState.resources.available, true);
  assert.equal(renderState.widgets.length, 1);
  assert.equal(renderState.visibleWidgets, 1);
  assert.equal(renderState.emptyReason, null);

  const widget = renderState.widgets[0];
  assert.equal(widget.id, "demo-score-widget");
  assert.equal(widget.packageId, visualPackageId);
  assert.equal(widget.reference, `${visualPackageId}/demo-score-widget`);
  assert.equal(widget.serviceRef, visualServiceRef);
  assert.equal(widget.contentTarget, contentTarget);
  assert.equal(widget.renderer.resource, "demoWidgetModule");
  assert.equal(widget.renderer.resourceRef, resourceReference(visualPackageId, "demoWidgetModule"));
  assert.equal(widget.renderer.available, true);
  assert.deepEqual(widget.frame, {
    x: 636,
    y: 536,
    width: 380,
    height: 160
  });
  assert.equal(widget.preview.score, "2-1");
  assert.equal(widget.preview.message, "Renderer resource ready");
  assert.equal(widget.preset.defaultLabel, "Visual Pack Widget");

  const moduleResource = widget.resources.find((resource) => resource.id === "demoWidgetModule");
  assert.ok(moduleResource, "Overlay Studio renderState should include the Visual Pack renderer module resource.");
  assert.equal(moduleResource.reference, resourceReference(visualPackageId, "demoWidgetModule"));
  assert.equal(moduleResource.type, "application/javascript");
  assert.equal(moduleResource.role, "overlay-widget-module");
  assert.ok(
    moduleResource.text.some((item) => item.path === "dist/visuals/demo-widget.js" && item.length > 0),
    "Overlay Studio renderState should read the Visual Pack renderer module resource."
  );

  const presetResource = widget.resources.find((resource) => resource.id === "widgetPreset");
  assert.ok(presetResource, "Overlay Studio renderState should include the Visual Pack preset resource.");
  assert.equal(presetResource.reference, resourceReference(visualPackageId, "widgetPreset"));
  assert.equal(presetResource.type, "application/json");
  assert.equal(presetResource.role, "widget-preset");
  assert.equal(presetResource.hasJson, true);
}

function assertNoOverlayWidgets(renderState) {
  assert.equal(renderState.discovery.available, true);
  assert.equal(renderState.discovery.contributions.length, 0);
  assert.equal(renderState.widgets.length, 0);
  assert.equal(renderState.visibleWidgets, 0);
  assert.equal(renderState.emptyReason, "no-active-visual-contributions");
}

const packageList = pocSpecs.map(loadPackage);
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
  const contentOwnerResources = await host
    .createRuntimeContext(contentPackageId)
    .resources.list({ packageId: contentPackageId });
  assert.ok(
    contentOwnerResources.some((resource) => resource.id === "privateNotes" && resource.public === false),
    "Content Pack should see its own private resource."
  );
  const overlayVisibleContentResources = await host
    .createRuntimeContext(overlayPackageId)
    .resources.list({ packageId: contentPackageId });
  assert.ok(
    !overlayVisibleContentResources.some((resource) => resource.id === "privateNotes"),
    "Overlay Studio should not discover Content Pack private resources."
  );
  await assert.rejects(
    () =>
      host
        .createRuntimeContext(overlayPackageId)
        .resources.readJson(resourceReference(contentPackageId, "privateNotes")),
    /Private resource must not be read cross-package/
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

  const commandWebviewOpen = await host.callCommand(webviewSettingsPackageId, "openSettings", [
    { source: "runtime-poc-command" }
  ]);
  assert.equal(commandWebviewOpen.ok, true);
  assert.equal(commandWebviewOpen.webviewId, "settings");
  assert.equal(commandWebviewOpen.result.packageId, webviewSettingsPackageId);
  assert.equal(commandWebviewOpen.result.webviewId, "settings");
  assert.deepEqual(commandWebviewOpen.result.options, { source: "runtime-poc-command" });
  assert.ok(
    host.calls.commandCalls.some(
      (call) => call.callerPackageId === webviewSettingsPackageId && call.ref === webviewSettingsCommandRef
    ),
    "POC webview settings should open its declared webview through the host command router."
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

  const visualTextReadCountBeforeRenderState = host.calls.readText.length;
  const visualJsonReadCountBeforeRenderState = host.calls.readJson.length;
  const overlayRenderState = await host.callService(overlayServiceRef, "renderState", {
    width: 1040,
    height: 720
  });
  assertOverlayRenderState(overlayRenderState);
  assert.ok(overlayRenderState.plugins.some((plugin) => plugin.id === contentPackageId));
  assert.ok(overlayRenderState.plugins.some((plugin) => plugin.id === visualPackageId));
  const visualPluginSummary = overlayRenderState.plugins.find((plugin) => plugin.id === visualPackageId);
  const contentPluginSummary = overlayRenderState.plugins.find((plugin) => plugin.id === contentPackageId);
  assert.ok(
    visualPluginSummary?.contributes?.contributions?.some((contribution) => contribution.id === "demo-score-widget"),
    "plugins.list should expose active package contribution metadata."
  );
  assert.ok(
    visualPluginSummary?.contributes?.resources?.some(
      (resource) => resource.id === "demoWidgetModule" && resource.public === true
    ),
    "plugins.list should expose public resources from other active packages."
  );
  assert.ok(
    contentPluginSummary?.contributes?.resources?.some(
      (resource) => resource.id === "overlayContent" && resource.public === true
    ),
    "plugins.list should include public content resources from content packages."
  );
  assert.ok(
    !contentPluginSummary?.contributes?.resources?.some((resource) => resource.id === "privateNotes"),
    "plugins.list should not expose private resources from another package."
  );
  assert.ok(
    host.calls.resourceList.some(
      (call) => call.packageId === visualPackageId && call.visibility === "public" && call.type === undefined
    ),
    "Overlay Studio renderState should list the Visual Pack public resources through the host resource API."
  );
  assert.ok(
    host.calls.readText
      .slice(visualTextReadCountBeforeRenderState)
      .some((call) => call.ref === resourceReference(visualPackageId, "demoWidgetModule")),
    "Overlay Studio renderState should read the Visual Pack renderer module through the host resource API."
  );
  assert.ok(
    host.calls.readJson
      .slice(visualJsonReadCountBeforeRenderState)
      .some((call) => call.ref === resourceReference(visualPackageId, "widgetPreset")),
    "Overlay Studio renderState should read the Visual Pack preset through the host resource API."
  );

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

  host.setActive([overlayPackageId]);
  const overlayOnlySnapshot = await host.callService(overlayServiceRef, "snapshot");
  assert.equal(overlayOnlySnapshot.source, "telemetry");
  assert.equal(overlayOnlySnapshot.score.matchGuid, "runtime-poc-host-snapshot");
  assert.equal(overlayOnlySnapshot.discovery.available, true);
  assert.equal(overlayOnlySnapshot.discovery.target, overlayTarget);
  assert.equal(overlayOnlySnapshot.discovery.contributions.length, 0);
  const overlayOnlyContributions = await host.callService(overlayServiceRef, "contributions");
  assert.equal(overlayOnlyContributions.contributions.length, 0);
  const overlayOnlyRenderState = await host.callService(overlayServiceRef, "renderState", {
    width: 1040,
    height: 720
  });
  assertNoOverlayWidgets(overlayOnlyRenderState);
  assert.ok(overlayOnlyRenderState.plugins.some((plugin) => plugin.id === overlayPackageId));
  assert.ok(!overlayOnlyRenderState.plugins.some((plugin) => plugin.id === visualPackageId));
  assert.ok(!overlayOnlyRenderState.plugins.some((plugin) => plugin.id === contentPackageId));
  const overlayOnlyPreviewModule = await host
    .createRuntimeContext(overlayPackageId)
    .resources.readText(resourceReference(overlayPackageId, "overlayPreviewModule"));
  assert.ok(
    overlayOnlyPreviewModule.includes("Overlay Studio POC"),
    "Overlay Studio should serve its own preview module without Visual Pack or Content Pack."
  );
  await assert.rejects(() => host.callService(visualServiceRef, "content"), /Service package is inactive/);

  const resourceReadCount = host.calls.readJson.length + host.calls.readText.length;
  host.setActive([overlayPackageId, visualPackageId]);
  const contentDisabled = await host.callService(visualServiceRef, "content");
  assert.equal(contentDisabled.available, true);
  assert.equal(contentDisabled.contributions.length, 0);
  assert.equal(contentDisabled.summary.contributionCount, 0);
  assert.equal(contentDisabled.summary.resourceCount, 0);
  assert.equal(host.calls.readJson.length + host.calls.readText.length, resourceReadCount);
  const contentDisabledRender = await host.callService(visualServiceRef, "renderWidget", { source: "content-disabled" });
  assert.equal(contentDisabledRender.render.title, null);
  assert.deepEqual(contentDisabledRender.render.messages, []);
  assert.deepEqual(contentDisabledRender.render.badgePaths, []);
  const overlayWithContentDisabled = await host.callService(overlayServiceRef, "renderState", {
    width: 1040,
    height: 720
  });
  assertOverlayRenderState(overlayWithContentDisabled);
  assert.ok(!overlayWithContentDisabled.plugins.some((plugin) => plugin.id === contentPackageId));

  host.setActive([visualPackageId, contentPackageId]);
  const overlayDisabledPoints = await host
    .createRuntimeContext(visualPackageId)
    .extensions.points({ packageId: overlayPackageId });
  assert.equal(overlayDisabledPoints.length, 0);
  const overlayDisabledVisualContributions = await host
    .createRuntimeContext(visualPackageId)
    .extensions.contributions(overlayTarget);
  assert.equal(overlayDisabledVisualContributions.length, 0);
  const overlayDisabledActiveContributions = await host
    .createRuntimeContext(visualPackageId)
    .extensions.contributions();
  assert.equal(overlayDisabledActiveContributions.length, 1);
  assertContentContribution(overlayDisabledActiveContributions[0]);
  await assert.rejects(() => host.callService(overlayServiceRef, "snapshot"), /Service package is inactive/);

  host.setActive([overlayPackageId, contentPackageId]);
  const visualDisabledSnapshot = await host.callService(overlayServiceRef, "snapshot");
  assert.equal(visualDisabledSnapshot.discovery.available, true);
  assert.equal(visualDisabledSnapshot.discovery.contributions.length, 0);
  const visualDisabledRenderState = await host.callService(overlayServiceRef, "renderState", {
    width: 1040,
    height: 720
  });
  assertNoOverlayWidgets(visualDisabledRenderState);
  assert.ok(!visualDisabledRenderState.plugins.some((plugin) => plugin.id === visualPackageId));
  await assert.rejects(() => host.callService(visualServiceRef, "content"), /Service package is inactive/);

  await visualExtension.deactivate();
  visualExtensionActive = false;
  const visualAbsentSnapshot = await host.callService(overlayServiceRef, "snapshot");
  assert.equal(visualAbsentSnapshot.discovery.contributions.length, 0);
  const visualAbsentRenderState = await host.callService(overlayServiceRef, "renderState", {
    width: 1040,
    height: 720
  });
  assertNoOverlayWidgets(visualAbsentRenderState);
} finally {
  if (visualExtensionActive) await visualExtension.deactivate();
  await overlayExtension.deactivate();
  if (sidecarExtensionActive) await sidecarExtension.deactivate();
  if (webviewSettingsExtensionActive) await webviewSettingsExtension.deactivate();
  await simpleExtension.deactivate();
}

await assertMissingApiFails(visualExtension, { resources: host.createRuntimeContext(visualPackageId).resources }, /requires host extensions\.contributions/);
await assertMissingApiFails(visualExtension, { extensions: host.createRuntimeContext(visualPackageId).extensions }, /requires host resources\.list/);

const productPackageList = productSpecs.map(loadPackage);
const productPackages = new Map(productPackageList.map((pkg) => [pkg.id, pkg]));
const productHost = createManifestRuntimeHost(productPackageList, undefined, initialTelemetryFrame, {
  [obsGatewayPackageId]: {
    enabled: true,
    listenAddress: "127.0.0.1",
    listenPort: 17844,
    routePrefix: "/overlay"
  }
});
const productExtensions = new Map();

for (const spec of productSpecs) {
  const pkg = requirePackage(productPackages, spec.packageId);
  productExtensions.set(spec.packageId, await loadExtension(pkg));
}

const activatedProducts = [];
try {
  for (const packageId of [
    statsPackageId,
    layoutPackageId,
    broadcastPackageId,
    playerStreakPackageId,
    dejaVuPackageId,
    obsGatewayPackageId
  ]) {
    const extension = productExtensions.get(packageId);
    await extension.activate(productHost.createRuntimeContext(packageId));
    activatedProducts.push(extension);
  }

  const statsSnapshot = await productHost.callService(`${statsPackageId}/playerStatsTracker`, "snapshot");
  assert.equal(statsSnapshot.version, 1);
  assert.ok(Array.isArray(statsSnapshot.matches));

  const layoutSnapshot = await productHost.callService(`${layoutPackageId}/layoutStudio`, "snapshot", {});
  assert.equal(layoutSnapshot.layouts.length, 1);
  assert.equal(layoutSnapshot.catalog.length, 11);
  for (const packageId of [broadcastPackageId, playerStreakPackageId, dejaVuPackageId]) {
    assert.ok(
      layoutSnapshot.catalog.some((item) => item.packageId === packageId),
      `Layout Studio should discover a visual from ${packageId}.`
    );
  }

  const scoreboard = layoutSnapshot.catalog.find((item) => item.packageId === broadcastPackageId && item.resourceId === "scoreboard");
  assert.ok(scoreboard, "Broadcast Visuals should contribute the scoreboard resource.");
  const source = await productHost.callService(`${layoutPackageId}/layoutStudio`, "resourceSource", {
    ref: scoreboard.resourceRef
  });
  assert.match(source.source, /Scoreboard|scoreboard/i);

  const layout = layoutSnapshot.layouts[0];
  layout.layers[0].items.push({
    id: "smoke-scoreboard",
    name: "Scoreboard",
    kind: "visual",
    packageId: broadcastPackageId,
    resourceId: scoreboard.resourceId,
    resourceRef: scoreboard.resourceRef,
    exportName: "default",
    x: 580,
    y: 40,
    width: 760,
    height: 128,
    zIndex: 0,
    visible: true,
    locked: false,
    opacity: 1,
    settings: {}
  });
  await productHost.callService(`${layoutPackageId}/layoutStudio`, "save", { layout });

  const savedSnapshot = await productHost.callService(`${layoutPackageId}/layoutStudio`, "snapshot", {});
  assert.equal(savedSnapshot.layouts[0].layers[0].items.length, 1);
  assert.ok(
    productHost.calls.sidecarCalls.some(
      (call) => call.packageId === obsGatewayPackageId
        && call.method === "updateHostData"
        && call.params?.snapshot?.layouts?.[0]?.layers?.[0]?.items?.[0]?.id === "smoke-scoreboard"
    ),
    "OBS Gateway should receive the saved Layout Studio document after a change event."
  );

  const regieSnapshot = await productHost.callService(`${broadcastPackageId}/regieController`, "snapshot", {});
  assert.equal(regieSnapshot.version, 1);
  const streakSnapshot = await productHost.callService(`${playerStreakPackageId}/playerStreak`, "snapshot", {});
  assert.equal(streakSnapshot.version, 1);
  const dejaVuSnapshot = await productHost.callService(`${dejaVuPackageId}/dejaVu`, "snapshot", {});
  assert.equal(dejaVuSnapshot.version, 1);
} finally {
  for (const extension of activatedProducts.reverse()) await extension.deactivate();
}

console.log("Runtime POC and product smoke passed.");
