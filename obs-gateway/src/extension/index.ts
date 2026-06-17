import type { ExtensionContext } from "@bakingrl/plugin-sdk";

const SIDECAR_NAME = "gateway";
const DEFAULT_SECRET_KEY_REF = "obs.gateway.accessToken";

type ObsGatewaySettings = {
  enabled?: unknown;
  listenAddress?: unknown;
  listenPort?: unknown;
  routePrefix?: unknown;
  streamPath?: unknown;
  secretKeyRef?: unknown;
  heartbeatMs?: unknown;
  allowedOrigins?: unknown;
};

function settingsObject(context: ExtensionContext): ObsGatewaySettings {
  const values = context.settings?.all?.() ?? {};
  return values && typeof values === "object" && !Array.isArray(values) ? values : {};
}

export async function activate(context: ExtensionContext): Promise<void> {
  await configureGateway(context);
}

async function configureGateway(context: ExtensionContext) {
  const settings = settingsObject(context);
  const secretKeyRef = typeof settings.secretKeyRef === "string" && settings.secretKeyRef.trim()
    ? settings.secretKeyRef.trim()
    : DEFAULT_SECRET_KEY_REF;
  const tokenConfigured = await context.secrets.configured(secretKeyRef).catch(() => false);
  const accessToken = tokenConfigured ? await context.secrets.get(secretKeyRef).catch(() => undefined) : undefined;

  await context.sidecars.start(SIDECAR_NAME);
  await context.sidecars.call(SIDECAR_NAME, "configure", {
    ...settings,
    secretKeyRef,
    tokenConfigured,
    accessToken: accessToken ?? null
  });
  context.diagnostics.log("obs-gateway sidecar configured");
}

export async function deactivate(): Promise<void> {
  // The host owns sidecar lifecycle; it sends bakingrl/shutdown during runtime stop.
}

export default {
  activate,
  deactivate
};
