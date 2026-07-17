import {
  defineExtension,
  type ExtensionContext,
  type ExtensionContributionDescriptor,
  type ExtensionSubscription,
  type ResourceDescriptor
} from "@bakingrl/plugin-sdk";
import type {
  LayoutDocument,
  LayoutItem,
  LayoutItemKind,
  LayoutLayer,
  LayoutStudioSnapshot,
  VisualCatalogItem
} from "../shared/layout";

const SERVICE_ID = "layoutStudio";
const VISUAL_TARGET = "bakingrl.layout-studio/visual";
const CHANGED_EVENT = "plugin.bakingrl.layout-studio.changed";
const STORAGE_PATH = "layouts.json";
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const MAX_LAYOUTS = 100;
const MAX_LAYERS = 64;
const MAX_ITEMS_PER_LAYER = 500;

type StoredState = {
  version: 1;
  activeLayoutId: string;
  layouts: LayoutDocument[];
};

let activeContext: ExtensionContext | null = null;
let registrations: ExtensionSubscription[] = [];
let latestTelemetry: unknown = null;
let state: StoredState = createDefaultState();
let writeChain: Promise<void> = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown) {
  return isRecord(value) ? value : {};
}

function string(value: unknown, fallback: string, maxLength = 120) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : fallback;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finite(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function integer(value: unknown, fallback: number, min: number, max: number) {
  return Math.trunc(finite(value, fallback, min, max));
}

function boolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function id(prefix: string) {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${suffix}`;
}

function clone<TValue>(value: TValue): TValue {
  return JSON.parse(JSON.stringify(value)) as TValue;
}

function normalizeKind(value: unknown): LayoutItemKind {
  return value === "text" || value === "shape" || value === "image" ? value : "visual";
}

function normalizeSettings(value: unknown) {
  return isRecord(value) ? clone(value) : {};
}

function normalizeItem(value: unknown, layoutWidth: number, layoutHeight: number, index: number): LayoutItem {
  const item = asRecord(value);
  const kind = normalizeKind(item.kind);
  const packageId = optionalString(item.packageId ?? item.package_id);
  const resourceId = optionalString(item.resourceId ?? item.resource_id);
  const exportName = optionalString(item.exportName ?? item.export_name ?? resourceId);
  const width = finite(item.width, kind === "visual" ? 640 : 420, 20, layoutWidth * 2);
  const height = finite(item.height, kind === "visual" ? 180 : 120, 20, layoutHeight * 2);
  return {
    id: string(item.id, id("item")),
    name: string(item.name, `${kind[0].toUpperCase()}${kind.slice(1)} ${index + 1}`),
    kind,
    ...(packageId ? { packageId } : {}),
    ...(resourceId ? { resourceId } : {}),
    ...(optionalString(item.resourceRef) ? { resourceRef: optionalString(item.resourceRef) } : {}),
    ...(exportName ? { exportName } : {}),
    x: finite(item.x, 40 + index * 20, -layoutWidth, layoutWidth * 2),
    y: finite(item.y, 40 + index * 20, -layoutHeight, layoutHeight * 2),
    width,
    height,
    zIndex: integer(item.zIndex ?? item.z_index, index, -10000, 10000),
    visible: boolean(item.visible, true),
    locked: boolean(item.locked, false),
    opacity: finite(item.opacity, 1, 0, 1),
    settings: normalizeSettings(item.settings)
  };
}

function normalizeLayer(value: unknown, layoutWidth: number, layoutHeight: number, index: number): LayoutLayer {
  const layer = asRecord(value);
  const items = Array.isArray(layer.items) ? layer.items.slice(0, MAX_ITEMS_PER_LAYER) : [];
  return {
    id: string(layer.id, id("layer")),
    name: string(layer.name, `Layer ${index + 1}`),
    kind: layer.kind === "event" ? "event" : "normal",
    visible: boolean(layer.visible, true),
    locked: boolean(layer.locked, false),
    order: integer(layer.order, index, -10000, 10000),
    items: items.map((item, itemIndex) => normalizeItem(item, layoutWidth, layoutHeight, itemIndex))
  };
}

function normalizeLayout(value: unknown, fallbackName = "Untitled layout"): LayoutDocument {
  const layout = asRecord(value);
  const now = Date.now();
  const width = integer(layout.width, DEFAULT_WIDTH, 320, 7680);
  const height = integer(layout.height, DEFAULT_HEIGHT, 180, 4320);
  const layers = Array.isArray(layout.layers) ? layout.layers.slice(0, MAX_LAYERS) : [];
  const normalizedLayers = layers.map((layer, index) => normalizeLayer(layer, width, height, index));
  return {
    version: 1,
    id: string(layout.id, id("layout")),
    name: string(layout.name, fallbackName),
    width,
    height,
    background: string(layout.background, "transparent", 80),
    layers: normalizedLayers.length > 0 ? normalizedLayers : [createLayer()],
    createdAtMs: integer(layout.createdAtMs, now, 0, Number.MAX_SAFE_INTEGER),
    updatedAtMs: now
  };
}

function createLayer(name = "Main"): LayoutLayer {
  return {
    id: id("layer"),
    name,
    kind: "normal",
    visible: true,
    locked: false,
    order: 0,
    items: []
  };
}

function createLayout(name = "Main layout"): LayoutDocument {
  return normalizeLayout({
    id: id("layout"),
    name,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    background: "transparent",
    layers: [createLayer()],
    createdAtMs: Date.now()
  });
}

function createDefaultState(): StoredState {
  const layout = createLayout();
  return {
    version: 1,
    activeLayoutId: layout.id,
    layouts: [layout]
  };
}

function restoreState(value: unknown): StoredState {
  const stored = asRecord(value);
  const layouts = Array.isArray(stored.layouts)
    ? stored.layouts.slice(0, MAX_LAYOUTS).map((layout, index) => normalizeLayout(layout, `Layout ${index + 1}`))
    : [];
  if (layouts.length === 0) return createDefaultState();
  const requestedActive = optionalString(stored.activeLayoutId);
  return {
    version: 1,
    activeLayoutId: layouts.some((layout) => layout.id === requestedActive) ? requestedActive! : layouts[0].id,
    layouts
  };
}

async function loadState(context: ExtensionContext) {
  try {
    state = restoreState(JSON.parse(await context.storage.readText(STORAGE_PATH)));
  } catch {
    state = createDefaultState();
    await persistState(context);
  }
}

function persistState(context: ExtensionContext) {
  const serialized = JSON.stringify(state, null, 2);
  writeChain = writeChain
    .then(() => context.storage.writeText(STORAGE_PATH, serialized))
    .catch(async (error) => {
      try {
        await context.diagnostics.warn("Layout Studio could not persist layouts.", error);
      } catch {
        // A diagnostic transport failure must not poison the persistence queue.
      }
    });
  return writeChain;
}

function resourceId(resource: ResourceDescriptor) {
  return optionalString(resource.id) ?? resource.reference.split("/").pop() ?? resource.reference;
}

function metadata(value: unknown) {
  return isRecord(value) ? value : {};
}

function contributionResources(contribution: ExtensionContributionDescriptor) {
  return Array.isArray(contribution.resources)
    ? contribution.resources.filter((value): value is string => typeof value === "string" && value.length > 0)
    : [];
}

function catalogItem(
  contribution: ExtensionContributionDescriptor,
  resource: ResourceDescriptor
): VisualCatalogItem {
  const details = metadata(contribution.metadata);
  const renderer = metadata(details.renderer);
  const defaultSize = Array.isArray(details.defaultSize) ? details.defaultSize : [];
  const width = integer(defaultSize[0], 640, 20, 7680);
  const height = integer(defaultSize[1], 180, 20, 4320);
  const itemId = string(contribution.id, resourceId(resource));
  return {
    id: `${contribution.packageId}/${itemId}`,
    reference: contribution.reference,
    packageId: contribution.packageId,
    resourceId: resourceId(resource),
    resourceRef: resource.reference,
    title: string(contribution.title, itemId),
    description: optionalString(contribution.description) ?? null,
    category: string(details.category, "Other"),
    defaultSize: [width, height],
    remoteCompatible: details.remoteCompatible !== false,
    exportName: string(renderer.export, "default")
  };
}

async function discoverCatalog(context: ExtensionContext) {
  const [contributions, resources] = await Promise.all([
    context.extensions.contributions(VISUAL_TARGET),
    context.resources.list({ visibility: "public" })
  ]);
  const byPackageAndId = new Map(resources.map((resource) => [`${resource.packageId}/${resourceId(resource)}`, resource]));
  const catalog: VisualCatalogItem[] = [];

  for (const contribution of contributions) {
    const details = metadata(contribution.metadata);
    const renderer = metadata(details.renderer);
    const rendererId = optionalString(renderer.resource);
    if (!rendererId || !contributionResources(contribution).includes(rendererId)) continue;
    const resource = byPackageAndId.get(`${contribution.packageId}/${rendererId}`);
    if (!resource || resource.public === false) continue;
    catalog.push(catalogItem(contribution, resource));
  }

  return catalog.sort((left, right) => left.category.localeCompare(right.category) || left.title.localeCompare(right.title));
}

async function snapshot(context: ExtensionContext): Promise<LayoutStudioSnapshot> {
  const catalog = await discoverCatalog(context);
  return {
    version: 1,
    activeLayoutId: state.activeLayoutId,
    active_layout_id: state.activeLayoutId,
    streamLayoutId: state.activeLayoutId,
    stream_layout_id: state.activeLayoutId,
    layouts: clone(state.layouts),
    catalog,
    telemetry: latestTelemetry,
    generatedAt: new Date().toISOString()
  };
}

function inputId(input: unknown) {
  return optionalString(asRecord(input).id);
}

function findLayout(layoutId: string | undefined) {
  return layoutId ? state.layouts.find((layout) => layout.id === layoutId) : undefined;
}

async function publishChange(context: ExtensionContext, reason: string, layoutId: string) {
  await persistState(context);
  context.bus.emit(CHANGED_EVENT, {
    version: 1,
    reason,
    layoutId,
    activeLayoutId: state.activeLayoutId,
    updatedAtMs: Date.now()
  });
}

async function saveLayout(context: ExtensionContext, input: unknown) {
  const raw = isRecord(input) && "layout" in input ? input.layout : input;
  const next = normalizeLayout(raw);
  const existingIndex = state.layouts.findIndex((layout) => layout.id === next.id);
  if (existingIndex >= 0) {
    next.createdAtMs = state.layouts[existingIndex].createdAtMs;
    state.layouts[existingIndex] = next;
  } else {
    if (state.layouts.length >= MAX_LAYOUTS) throw new Error(`Layout limit reached (${MAX_LAYOUTS}).`);
    state.layouts.push(next);
  }
  if (!state.activeLayoutId) state.activeLayoutId = next.id;
  await publishChange(context, existingIndex >= 0 ? "saved" : "created", next.id);
  return clone(next);
}

async function removeLayout(context: ExtensionContext, input: unknown) {
  const layoutId = inputId(input);
  if (!layoutId || !findLayout(layoutId)) throw new Error("Layout not found.");
  state.layouts = state.layouts.filter((layout) => layout.id !== layoutId);
  if (state.layouts.length === 0) state.layouts.push(createLayout());
  if (state.activeLayoutId === layoutId) state.activeLayoutId = state.layouts[0].id;
  await publishChange(context, "removed", layoutId);
  return snapshot(context);
}

async function duplicateLayout(context: ExtensionContext, input: unknown) {
  const values = asRecord(input);
  const source = findLayout(optionalString(values.id));
  if (!source) throw new Error("Layout not found.");
  const duplicate = normalizeLayout({
    ...clone(source),
    id: id("layout"),
    name: string(values.name, `${source.name} copy`),
    createdAtMs: Date.now(),
    layers: source.layers.map((layer) => ({
      ...clone(layer),
      id: id("layer"),
      items: layer.items.map((item) => ({ ...clone(item), id: id("item") }))
    }))
  });
  state.layouts.push(duplicate);
  await publishChange(context, "duplicated", duplicate.id);
  return clone(duplicate);
}

async function setActiveLayout(context: ExtensionContext, input: unknown) {
  const layoutId = inputId(input);
  if (!layoutId || !findLayout(layoutId)) throw new Error("Layout not found.");
  state.activeLayoutId = layoutId;
  await publishChange(context, "activated", layoutId);
  return snapshot(context);
}

async function resourceSource(context: ExtensionContext, input: unknown) {
  const ref = optionalString(asRecord(input).ref);
  if (!ref) throw new Error("A public visual resource reference is required.");
  const catalog = await discoverCatalog(context);
  const visual = catalog.find((item) => item.resourceRef === ref);
  if (!visual) throw new Error("Visual resource is not part of the active Layout Studio catalogue.");
  return {
    ref,
    source: await context.resources.readText(ref),
    packageId: visual.packageId,
    resourceId: visual.resourceId
  };
}

function registerService(context: ExtensionContext) {
  return context.services.register(SERVICE_ID, {
    snapshot: () => snapshot(context),
    catalog: () => discoverCatalog(context),
    list: () => ({
      activeLayoutId: state.activeLayoutId,
      layouts: state.layouts.map((layout) => ({
        id: layout.id,
        name: layout.name,
        width: layout.width,
        height: layout.height,
        itemCount: layout.layers.reduce((total, layer) => total + layer.items.length, 0),
        updatedAtMs: layout.updatedAtMs
      }))
    }),
    get(input) {
      const layout = findLayout(inputId(input));
      if (!layout) throw new Error("Layout not found.");
      return clone(layout);
    },
    save: (input) => saveLayout(context, input),
    remove: (input) => removeLayout(context, input),
    duplicate: (input) => duplicateLayout(context, input),
    setActive: (input) => setActiveLayout(context, input),
    resourceSource: (input) => resourceSource(context, input)
  });
}

async function disposeRegistrations(items: ExtensionSubscription[]) {
  for (const registration of items.reverse()) await registration.dispose();
}

const extension = defineExtension({
  async activate(context: ExtensionContext) {
    await deactivate();
    activeContext = context;
    await loadState(context);
    latestTelemetry = await Promise.resolve(context.telemetryHub.snapshot()).catch(() => null);
    const telemetryCleanup = context.telemetryHub.subscribe("UpdateState", (event) => {
      latestTelemetry = event;
    });
    const serviceRegistration = registerService(context);
    registrations = [{ dispose: telemetryCleanup }, serviceRegistration];
    context.subscriptions.push(...registrations);
    try {
      await context.logger.info(`Layout Studio activated with ${state.layouts.length} layout(s).`);
    } catch {
      // Logging is best effort and must not turn a successful activation into a failure.
    }
  },
  deactivate
});

export async function deactivate() {
  const activeRegistrations = registrations;
  registrations = [];
  activeContext = null;
  await disposeRegistrations(activeRegistrations);
}

export const activate = extension.activate;
export default extension;
