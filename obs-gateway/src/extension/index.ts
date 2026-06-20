import type { ExtensionContext, ExtensionSubscription, ResourceDescriptor } from "@bakingrl/plugin-sdk";

const SERVICE_ID = "obsGateway";
const SIDECAR_NAME = "gateway";
const DEFAULT_SECRET_KEY_REF = "obs.gateway.accessToken";
const RENDERER_RESOURCE_ROLE = "renderer-module";
const DEFAULT_LAYOUT_WIDTH = 1920;
const DEFAULT_LAYOUT_HEIGHT = 1080;

type ObsGatewaySettings = {
  enabled?: unknown;
  listenAddress?: unknown;
  listenPort?: unknown;
  routePrefix?: unknown;
  streamPath?: unknown;
  streamLayoutId?: unknown;
  secretKeyRef?: unknown;
  requireToken?: unknown;
  heartbeatMs?: unknown;
  allowedOrigins?: unknown;
};

let registrations: ExtensionSubscription[] = [];
let activeContext: ExtensionContext | null = null;

function settingsObject(context: ExtensionContext): ObsGatewaySettings {
  const values = context.settings?.all?.() ?? {};
  return values && typeof values === "object" && !Array.isArray(values) ? values : {};
}

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readSecret(context: ExtensionContext, settings: ObsGatewaySettings) {
  const secretKeyRef = cleanString(settings.secretKeyRef) ?? DEFAULT_SECRET_KEY_REF;
  const tokenConfigured = await context.secrets.configured(secretKeyRef).catch(() => false);
  const accessToken = tokenConfigured ? await context.secrets.get(secretKeyRef).catch(() => undefined) : undefined;
  return {
    secretKeyRef,
    tokenConfigured,
    accessToken: accessToken ?? null
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function resourceMetadata(resource: ResourceDescriptor) {
  return isRecord(resource.metadata) ? resource.metadata : {};
}

function resourceId(resource: ResourceDescriptor) {
  return cleanString(resource.id);
}

function resourceTitle(resource: ResourceDescriptor) {
  const metadata = resourceMetadata(resource);
  return cleanString(metadata.title) ?? cleanString(metadata.name) ?? resourceId(resource) ?? resource.reference;
}

function safeLayoutSegment(value: string) {
  return value.trim().replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "resource";
}

function defaultSize(resource: ResourceDescriptor) {
  const size = resourceMetadata(resource).defaultSize;
  const values = Array.isArray(size) ? size : [];
  const width = Number(values[0]);
  const height = Number(values[1]);
  return {
    width: Number.isFinite(width) && width > 0 ? width : 420,
    height: Number.isFinite(height) && height > 0 ? height : 180
  };
}

function isRendererResource(resource: ResourceDescriptor) {
  const metadata = resourceMetadata(resource);
  const type = cleanString(resource.type);
  return (
    resource.public !== false &&
    metadata.role === RENDERER_RESOURCE_ROLE &&
    (!type || type.includes("javascript"))
  );
}

function rendererLayoutFor(resource: ResourceDescriptor) {
  const id = resourceId(resource) ?? safeLayoutSegment(resource.reference);
  const title = resourceTitle(resource);
  const size = defaultSize(resource);
  const width = Math.max(DEFAULT_LAYOUT_WIDTH, Math.ceil(size.width));
  const height = Math.max(DEFAULT_LAYOUT_HEIGHT, Math.ceil(size.height));
  const itemWidth = Math.min(width, Math.ceil(size.width));
  const itemHeight = Math.min(height, Math.ceil(size.height));
  const item = {
    id: `item-${safeLayoutSegment(resource.reference)}`,
    name: title,
    kind: "visual",
    package_id: resource.packageId,
    packageId: resource.packageId,
    export_name: id,
    exportName: id,
    resource_id: id,
    resourceId: id,
    resourceRef: resource.reference,
    x: Math.round((width - itemWidth) / 2),
    y: Math.round((height - itemHeight) / 2),
    width: itemWidth,
    height: itemHeight,
    z_index: 0,
    zIndex: 0,
    visible: true,
    settings: {
      resource: {
        id,
        reference: resource.reference,
        type: resource.type ?? null,
        metadata: resource.metadata ?? null
      }
    }
  };
  return {
    id: `resource-${safeLayoutSegment(resource.reference)}`,
    name: `${resource.packageId}/${title}`,
    source: "plugin-resources",
    width,
    height,
    layers: [
      {
        id: "renderer",
        name: "Renderer",
        kind: "normal",
        visible: true,
        locked: false,
        order: 0,
        items: [item]
      }
    ],
    items: [item]
  };
}

async function collectHostData(context: ExtensionContext) {
  let resources: ResourceDescriptor[];
  try {
    resources = await context.resources.list({ visibility: "public" });
  } catch (error) {
    const message = `Public renderer resources are not available: ${errorMessage(error)}`;
    return {
      layouts: [],
      snapshot: {
        source: "plugin-resources",
        layouts: [],
        error: message
      },
      hostApiAvailable: false,
      error: message
    };
  }

  const telemetry = (await Promise.resolve(context.telemetryHub?.snapshot?.()).catch(() => null)) ?? null;
  const layouts = resources
    .filter(isRendererResource)
    .sort((a, b) => a.reference.localeCompare(b.reference))
    .map(rendererLayoutFor);
  const streamLayoutId = layouts[0]?.id ?? null;
  const snapshot = {
    source: "plugin-resources",
    generatedAt: new Date().toISOString(),
    stream_layout_id: streamLayoutId,
    streamLayoutId,
    telemetry,
    layouts
  };

  return {
    layouts: layouts.map((layout) => ({
      id: layout.id,
      name: layout.name,
      source: layout.source,
      itemCount: layout.items.length
    })),
    snapshot,
    hostApiAvailable: true,
    error: layouts.length === 0 ? "No public renderer-module resources are available." : undefined
  };
}

async function callSidecar<TOutput = unknown>(method: string, params?: unknown): Promise<TOutput> {
  const context = activeContext;
  if (!context) throw new Error("OBS Gateway extension is not active.");
  await context.sidecars.start(SIDECAR_NAME);
  return context.sidecars.call<TOutput>(SIDECAR_NAME, method, params);
}

async function updateHostData(context: ExtensionContext) {
  const hostData = await collectHostData(context);
  return context.sidecars.call(SIDECAR_NAME, "updateHostData", hostData);
}

async function configureGateway(context: ExtensionContext, overrides: ObsGatewaySettings = {}) {
  const settings = {
    ...settingsObject(context),
    ...overrides
  };
  const secret = await readSecret(context, settings);

  await context.sidecars.start(SIDECAR_NAME);
  const snapshot = await context.sidecars.call(SIDECAR_NAME, "configure", {
    ...settings,
    ...secret
  });
  const refreshed = await updateHostData(context).catch((error) => {
    context.diagnostics.warn("OBS gateway host data refresh failed.", error);
    return snapshot;
  });
  context.diagnostics.log("obs-gateway sidecar configured");
  return refreshed;
}

function registerService(context: ExtensionContext) {
  return context.services.register(SERVICE_ID, {
    async snapshot() {
      return callSidecar("snapshot");
    },
    async configure(input) {
      return configureGateway(context, isRecord(input) ? input : {});
    },
    async setConnectionState(input) {
      return callSidecar("setConnectionState", input);
    },
    async updateHostData(input) {
      return callSidecar("updateHostData", isRecord(input) ? input : {});
    },
    async refreshHostData() {
      return updateHostData(context);
    }
  });
}

async function disposeRegistrations(items: ExtensionSubscription[]) {
  for (const registration of items.reverse()) {
    await registration.dispose();
  }
}

export async function activate(context: ExtensionContext): Promise<void> {
  await deactivate();
  activeContext = context;
  const registration = registerService(context);
  registrations = [registration];
  context.subscriptions?.push(registration);
  await configureGateway(context);
}

export async function deactivate(): Promise<void> {
  const activeRegistrations = registrations;
  registrations = [];
  activeContext = null;
  await disposeRegistrations(activeRegistrations);
}

export default {
  activate,
  deactivate
};
