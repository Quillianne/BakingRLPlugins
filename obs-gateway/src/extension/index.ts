import type { ExtensionContext, ExtensionSubscription } from "@bakingrl/plugin-sdk";

const SERVICE_ID = "obsGateway";
const SIDECAR_NAME = "gateway";
const LAYOUT_SERVICE_REF = "bakingrl.layout-studio/layoutStudio";
const LAYOUT_CHANGED_EVENT = "plugin.bakingrl.layout-studio.changed";
const DEFAULT_SECRET_KEY_REF = "obs.gateway.accessToken";

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

type LayoutDocument = {
  id?: string;
  name?: string;
  layers?: Array<{ items?: unknown[] }>;
  items?: unknown[];
};

type LayoutSnapshot = {
  activeLayoutId?: string;
  active_layout_id?: string;
  streamLayoutId?: string;
  stream_layout_id?: string;
  layouts?: LayoutDocument[];
  telemetry?: unknown;
  [key: string]: unknown;
};

let registrations: ExtensionSubscription[] = [];
let activeContext: ExtensionContext | null = null;
let refreshChain: Promise<unknown> = Promise.resolve();

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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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

function layoutItemCount(layout: LayoutDocument) {
  if (Array.isArray(layout.layers)) {
    return layout.layers.reduce((total, layer) => total + (Array.isArray(layer.items) ? layer.items.length : 0), 0);
  }
  return Array.isArray(layout.items) ? layout.items.length : 0;
}

async function collectHostData(context: ExtensionContext) {
  try {
    const snapshot = await context.services.call<LayoutSnapshot>(LAYOUT_SERVICE_REF, "snapshot", {});
    const layouts = Array.isArray(snapshot.layouts) ? snapshot.layouts : [];
    return {
      layouts: layouts
        .filter((layout): layout is LayoutDocument & { id: string } => typeof layout.id === "string" && layout.id.length > 0)
        .map((layout) => ({
          id: layout.id,
          name: typeof layout.name === "string" && layout.name ? layout.name : layout.id,
          source: "layout-studio",
          itemCount: layoutItemCount(layout)
        })),
      snapshot: {
        ...snapshot,
        source: "layout-studio"
      },
      hostApiAvailable: true,
      error: layouts.length === 0 ? "Layout Studio has no saved layouts." : undefined
    };
  } catch (error) {
    const message = `Layout Studio is not available: ${errorMessage(error)}`;
    return {
      layouts: [],
      snapshot: {
        source: "layout-studio",
        layouts: [],
        error: message
      },
      hostApiAvailable: false,
      error: message
    };
  }
}

async function callSidecar<TOutput = unknown>(method: string, params?: unknown): Promise<TOutput> {
  const context = activeContext;
  if (!context) throw new Error("OBS Gateway extension is not active.");
  await context.sidecars.start(SIDECAR_NAME);
  return context.sidecars.call<TOutput>(SIDECAR_NAME, method, params);
}

function updateHostData(context: ExtensionContext) {
  refreshChain = refreshChain
    .catch(() => undefined)
    .then(async () => {
      const hostData = await collectHostData(context);
      return context.sidecars.call(SIDECAR_NAME, "updateHostData", hostData);
    });
  return refreshChain;
}

async function configureGateway(context: ExtensionContext, overrides: ObsGatewaySettings = {}) {
  const settings = {
    ...settingsObject(context),
    ...overrides
  };
  const secret = await readSecret(context, settings);

  await context.sidecars.start(SIDECAR_NAME);
  const configured = await context.sidecars.call(SIDECAR_NAME, "configure", {
    ...settings,
    ...secret
  });
  const refreshed = await updateHostData(context).catch((error) => {
    context.diagnostics.warn("OBS Gateway layout refresh failed.", error);
    return configured;
  });
  context.diagnostics.log("OBS Gateway configured from Layout Studio.");
  return refreshed;
}

function registerService(context: ExtensionContext) {
  return context.services.register(SERVICE_ID, {
    snapshot() {
      return callSidecar("snapshot");
    },
    configure(input) {
      return configureGateway(context, isRecord(input) ? input : {});
    },
    setConnectionState(input) {
      return callSidecar("setConnectionState", input);
    },
    updateHostData(input) {
      return callSidecar("updateHostData", isRecord(input) ? input : {});
    },
    refreshHostData() {
      return updateHostData(context);
    }
  });
}

async function disposeRegistrations(items: ExtensionSubscription[]) {
  for (const registration of items.reverse()) await registration.dispose();
}

export async function activate(context: ExtensionContext) {
  await deactivate();
  activeContext = context;
  const serviceRegistration = registerService(context);
  const stopLayoutSubscription = context.bus.subscribe(LAYOUT_CHANGED_EVENT, () => {
    void updateHostData(context).catch((error) => context.diagnostics.warn("OBS Gateway could not apply a layout change.", error));
  });
  registrations = [
    serviceRegistration,
    { dispose: stopLayoutSubscription }
  ];
  context.subscriptions.push(...registrations);
  await configureGateway(context);
}

export async function deactivate() {
  const activeRegistrations = registrations;
  registrations = [];
  activeContext = null;
  refreshChain = Promise.resolve();
  await disposeRegistrations(activeRegistrations);
}

export default { activate, deactivate };
