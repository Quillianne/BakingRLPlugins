import type { PluginRuntimeContext, RuntimeService } from "../../extension/runtimeService";

type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

export type ObsGatewayConfig = {
  enabled: boolean;
  listenAddress: string;
  listenPort: number;
  routePrefix: string;
  streamPath: string;
  secretKeyRef: string;
  heartbeatMs: number;
  allowedOrigins: string[];
};

type ObsGatewayRuntimeState = {
  config: ObsGatewayConfig;
  connected: ConnectionState;
  lastConnectedAtMs: number | null;
  lastStateChangeAtMs: number;
  lastError?: string;
};

type ConfigureInput = {
  enabled?: unknown;
  listenAddress?: unknown;
  listenPort?: unknown;
  routePrefix?: unknown;
  streamPath?: unknown;
  secretKeyRef?: unknown;
  heartbeatMs?: unknown;
  allowedOrigins?: unknown;
};

type SetConnectionStateInput = {
  state?: unknown;
  error?: unknown;
};

const DEFAULT_CONFIG: ObsGatewayConfig = {
  enabled: true,
  listenAddress: "127.0.0.1",
  listenPort: 4455,
  routePrefix: "/overlay",
  streamPath: "/stream",
  secretKeyRef: "obs.gateway.accessToken",
  heartbeatMs: 15000,
  allowedOrigins: ["http://localhost", "http://127.0.0.1"]
};

const DEFAULT_STATE: ObsGatewayRuntimeState = {
  config: { ...DEFAULT_CONFIG },
  connected: "disconnected",
  lastConnectedAtMs: null,
  lastStateChangeAtMs: Date.now()
};

let runtimeState: ObsGatewayRuntimeState = { ...DEFAULT_STATE };
let serviceContext: PluginRuntimeContext | null = null;

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asPositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const intValue = Math.trunc(value);
  return intValue > 0 ? intValue : fallback;
}

function asConnectionState(value: unknown, fallback: ConnectionState): ConnectionState {
  return value === "connecting" || value === "connected" || value === "error" || value === "disconnected" ? value : fallback;
}

function asAllowedOrigins(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const values = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return values.length > 0 ? values : fallback;
}

function sanitizeConfig(input: ConfigureInput): ObsGatewayConfig {
  return {
    enabled: asBoolean(input.enabled, runtimeState.config.enabled),
    listenAddress: asString(input.listenAddress, runtimeState.config.listenAddress),
    listenPort: asPositiveInteger(input.listenPort, runtimeState.config.listenPort),
    routePrefix: asString(input.routePrefix, runtimeState.config.routePrefix),
    streamPath: asString(input.streamPath, runtimeState.config.streamPath),
    secretKeyRef: asString(input.secretKeyRef, runtimeState.config.secretKeyRef),
    heartbeatMs: asPositiveInteger(input.heartbeatMs, runtimeState.config.heartbeatMs),
    allowedOrigins: asAllowedOrigins(input.allowedOrigins, runtimeState.config.allowedOrigins)
  };
}

function applyConfiguration(input: ConfigureInput) {
  runtimeState.config = sanitizeConfig(input);
  runtimeState.lastStateChangeAtMs = Date.now();

  // TODO: replace this with host OBS control wiring once the final runtime contract is available.
  // Current skeleton stores local state only.
}

function applyConnectionState(input: SetConnectionStateInput) {
  const nextState = asConnectionState(input.state, runtimeState.connected);
  runtimeState.connected = nextState;
  runtimeState.lastStateChangeAtMs = Date.now();
  runtimeState.lastError = input.error && typeof input.error === "string" ? input.error.trim() : undefined;

  if (nextState === "connected") {
    runtimeState.lastConnectedAtMs = Date.now();
  }
}

function snapshot() {
  return {
    ...runtimeState,
    config: {
      ...runtimeState.config,
      allowedOrigins: [...runtimeState.config.allowedOrigins]
    },
    lastConnectedAtMs: runtimeState.lastConnectedAtMs,
    lastStateChangeAtMs: runtimeState.lastStateChangeAtMs
  };
}

function readSettingsAsConfig(context: PluginRuntimeContext) {
  const source = context.settings.all();
  if (!source || typeof source !== "object") return;

  applyConfiguration({
    enabled: source.enabled,
    listenAddress: source.listenAddress,
    listenPort: source.listenPort,
    routePrefix: source.routePrefix,
    streamPath: source.streamPath,
    secretKeyRef: source.secretKeyRef,
    heartbeatMs: source.heartbeatMs,
    allowedOrigins: source.allowedOrigins
  });
}

export default {
  async mount(context: PluginRuntimeContext) {
    serviceContext = context;
    readSettingsAsConfig(context);
    context.diagnostics.log("obs-gateway runtime service mounted");
  },
  unmount() {
    serviceContext = null;
  },
  methods: {
    async snapshot(): Promise<unknown> {
      return snapshot();
    },
    async configure(input: unknown): Promise<unknown> {
      applyConfiguration((input ?? {}) as ConfigureInput);
      return snapshot();
    },
    async setConnectionState(input: unknown): Promise<unknown> {
      applyConnectionState((input ?? {}) as SetConnectionStateInput);

      if (serviceContext) {
        // TODO: align with final host OBS primitives by emitting telemetry in a future update.
        serviceContext.diagnostics.log(`obs-gateway connection state set to ${runtimeState.connected}`);
      }
      return snapshot();
    }
  }
} satisfies RuntimeService;
