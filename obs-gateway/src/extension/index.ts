import type { ExtensionContext, ExtensionSubscription } from "@bakingrl/plugin-sdk";

const SERVICE_ID = "obsGateway";
const SIDECAR_NAME = "gateway";
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

type HostLayout = {
  id: string;
  name: string;
  source: string;
  itemCount?: number;
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

function normalizeLayout(value: unknown, index: number): HostLayout | null {
  if (!isRecord(value)) return null;
  const id = cleanString(value.id) ?? cleanString(value.layoutId) ?? cleanString(value.name) ?? `layout-${index + 1}`;
  const name = cleanString(value.name) ?? cleanString(value.title) ?? id;
  const source = cleanString(value.source) ?? cleanString(value.kind) ?? "host";
  const items = Array.isArray(value.items) ? value.items.length : Array.isArray(value.visuals) ? value.visuals.length : undefined;
  return { id, name, source, itemCount: items };
}

function normalizeLayouts(value: unknown): HostLayout[] {
  const rawLayouts = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.layouts)
      ? value.layouts
      : isRecord(value) && Array.isArray(value.overlays)
        ? value.overlays
        : [];
  const seen = new Set<string>();
  return rawLayouts
    .map(normalizeLayout)
    .filter((layout): layout is HostLayout => {
      if (!layout || seen.has(layout.id)) return false;
      seen.add(layout.id);
      return true;
    });
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

async function collectHostData(_context: ExtensionContext) {
  return {
    layouts: [],
    snapshot: null,
    hostApiAvailable: false,
    error: "Host-owned overlay layout discovery is not available in runtime API 2.2."
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
