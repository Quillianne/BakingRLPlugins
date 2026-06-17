import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Socket } from "node:net";

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

type GatewayServerState = {
  listening: boolean;
  address: string;
  port: number;
  healthUrl: string | null;
  snapshotUrl: string | null;
  streamUrl: string | null;
  websocketUrl: string | null;
  clientCount: number;
  startedAtMs: number | null;
};

type GatewayAuthState = {
  secretKeyRef: string;
  configured: boolean;
  required: boolean;
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

type GatewayEvent = {
  type: "connection" | "heartbeat" | "server" | "snapshot";
  atMs: number;
  payload: unknown;
};

type SseClient = {
  id: number;
  response: ServerResponse;
};

type WebSocketClient = {
  id: number;
  socket: Socket;
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

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_JSON_BODY_BYTES = 64 * 1024;

let runtimeState: ObsGatewayRuntimeState = { ...DEFAULT_STATE };
let serviceContext: PluginRuntimeContext | null = null;
let gatewayServer: Server | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let configuredToken: string | undefined;
let tokenConfigured = false;
let gatewayStartedAtMs: number | null = null;
let nextClientId = 1;

const sseClients = new Map<number, SseClient>();
const webSocketClients = new Map<number, WebSocketClient>();

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asPositiveInteger(value: unknown, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const intValue = Math.trunc(value);
  if (intValue < min || intValue > max) return fallback;
  return intValue;
}

function asConnectionState(value: unknown, fallback: ConnectionState): ConnectionState {
  return value === "connecting" || value === "connected" || value === "error" || value === "disconnected" ? value : fallback;
}

function asAllowedOrigins(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const values = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return values.length > 0 ? Array.from(new Set(values)) : fallback;
}

function normalizePath(value: unknown, fallback: string): string {
  const raw = asString(value, fallback).replace(/\/+/g, "/");
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/$/, "") : withLeadingSlash;
}

function joinRoute(prefix: string, path: string): string {
  const normalizedPrefix = normalizePath(prefix, "/");
  const normalizedPath = normalizePath(path, "/");
  if (normalizedPrefix === "/") return normalizedPath;
  if (normalizedPath === "/") return normalizedPrefix;
  return `${normalizedPrefix}${normalizedPath}`;
}

function routes(config = runtimeState.config) {
  const streamRoute = joinRoute(config.routePrefix, config.streamPath);
  return {
    health: joinRoute(config.routePrefix, "/health"),
    snapshot: joinRoute(config.routePrefix, "/snapshot"),
    stream: streamRoute,
    websocket: joinRoute(streamRoute, "/ws"),
    configure: joinRoute(config.routePrefix, "/configure"),
    connectionState: joinRoute(config.routePrefix, "/connection-state")
  };
}

function publicBaseUrl(config = runtimeState.config) {
  const host = config.listenAddress === "0.0.0.0" || config.listenAddress === "::" ? "127.0.0.1" : config.listenAddress;
  return `http://${host}:${config.listenPort}`;
}

function sanitizeConfig(input: ConfigureInput): ObsGatewayConfig {
  return {
    enabled: asBoolean(input.enabled, runtimeState.config.enabled),
    listenAddress: asString(input.listenAddress, runtimeState.config.listenAddress),
    listenPort: asPositiveInteger(input.listenPort, runtimeState.config.listenPort, 1024, 65535),
    routePrefix: normalizePath(input.routePrefix, runtimeState.config.routePrefix),
    streamPath: normalizePath(input.streamPath, runtimeState.config.streamPath),
    secretKeyRef: asString(input.secretKeyRef, runtimeState.config.secretKeyRef),
    heartbeatMs: asPositiveInteger(input.heartbeatMs, runtimeState.config.heartbeatMs, 1000),
    allowedOrigins: asAllowedOrigins(input.allowedOrigins, runtimeState.config.allowedOrigins)
  };
}

function applyConfiguration(input: ConfigureInput) {
  runtimeState.config = sanitizeConfig(input);
  runtimeState.lastStateChangeAtMs = Date.now();
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

function serverState(): GatewayServerState {
  const config = runtimeState.config;
  const baseUrl = publicBaseUrl(config);
  const routeMap = routes(config);
  const listening = gatewayServer !== null;

  return {
    listening,
    address: config.listenAddress,
    port: config.listenPort,
    healthUrl: listening ? `${baseUrl}${routeMap.health}` : null,
    snapshotUrl: listening ? `${baseUrl}${routeMap.snapshot}` : null,
    streamUrl: listening ? `${baseUrl}${routeMap.stream}` : null,
    websocketUrl: listening ? `${baseUrl.replace(/^http:/, "ws:")}${routeMap.websocket}` : null,
    clientCount: sseClients.size + webSocketClients.size,
    startedAtMs: gatewayStartedAtMs
  };
}

function authState(): GatewayAuthState {
  return {
    secretKeyRef: runtimeState.config.secretKeyRef,
    configured: tokenConfigured,
    required: typeof configuredToken === "string" && configuredToken.length > 0
  };
}

function snapshot() {
  return {
    ...runtimeState,
    config: {
      ...runtimeState.config,
      allowedOrigins: [...runtimeState.config.allowedOrigins]
    },
    auth: authState(),
    server: serverState(),
    lastConnectedAtMs: runtimeState.lastConnectedAtMs,
    lastStateChangeAtMs: runtimeState.lastStateChangeAtMs
  };
}

function event(type: GatewayEvent["type"], payload: unknown): GatewayEvent {
  return {
    type,
    atMs: Date.now(),
    payload
  };
}

function sendSse(client: SseClient, gatewayEvent: GatewayEvent) {
  client.response.write(`event: obsGateway\ndata: ${JSON.stringify(gatewayEvent)}\n\n`);
}

function encodeWebSocketText(payload: string): Uint8Array {
  const body = new TextEncoder().encode(payload);
  const headerLength = body.length < 126 ? 2 : body.length <= 65535 ? 4 : 10;
  const frame = new Uint8Array(headerLength + body.length);
  frame[0] = 0x81;

  if (body.length < 126) {
    frame[1] = body.length;
  } else if (body.length <= 65535) {
    frame[1] = 126;
    frame[2] = (body.length >> 8) & 0xff;
    frame[3] = body.length & 0xff;
  } else {
    frame[1] = 127;
    const high = Math.floor(body.length / 2 ** 32);
    const low = body.length >>> 0;
    frame[2] = (high >> 24) & 0xff;
    frame[3] = (high >> 16) & 0xff;
    frame[4] = (high >> 8) & 0xff;
    frame[5] = high & 0xff;
    frame[6] = (low >> 24) & 0xff;
    frame[7] = (low >> 16) & 0xff;
    frame[8] = (low >> 8) & 0xff;
    frame[9] = low & 0xff;
  }

  frame.set(body, headerLength);
  return frame;
}

function sendWebSocket(client: WebSocketClient, gatewayEvent: GatewayEvent) {
  client.socket.write(encodeWebSocketText(JSON.stringify(gatewayEvent)));
}

function broadcast(gatewayEvent: GatewayEvent) {
  for (const client of sseClients.values()) sendSse(client, gatewayEvent);
  for (const client of webSocketClients.values()) sendWebSocket(client, gatewayEvent);
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    broadcast(event("heartbeat", {
      connected: runtimeState.connected,
      server: serverState()
    }));
  }, runtimeState.config.heartbeatMs);
}

function stopHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function closeClients() {
  for (const client of sseClients.values()) client.response.end();
  for (const client of webSocketClients.values()) client.socket.end();
  sseClients.clear();
  webSocketClients.clear();
}

function originHeader(request: IncomingMessage): string | undefined {
  const value = request.headers.origin;
  return Array.isArray(value) ? value[0] : value;
}

function authorizationHeader(request: IncomingMessage): string | undefined {
  const value = request.headers.authorization;
  return Array.isArray(value) ? value[0] : value;
}

function hostHeader(request: IncomingMessage): string {
  const value = request.headers.host;
  return Array.isArray(value) ? value[0] ?? "localhost" : value ?? "localhost";
}

function originsMatch(allowed: string, origin: string): boolean {
  if (allowed === "*") return true;
  if (allowed === origin) return true;

  try {
    const allowedUrl = new URL(allowed);
    const originUrl = new URL(origin);
    const allowedPort = allowedUrl.port;
    return allowedUrl.protocol === originUrl.protocol
      && allowedUrl.hostname === originUrl.hostname
      && (allowedPort === "" || allowedPort === originUrl.port);
  } catch {
    return false;
  }
}

function isOriginAllowed(request: IncomingMessage): boolean {
  const origin = originHeader(request);
  if (!origin) return true;
  return runtimeState.config.allowedOrigins.some((allowed) => originsMatch(allowed, origin));
}

function setCorsHeaders(request: IncomingMessage, response: ServerResponse) {
  const origin = originHeader(request);
  if (origin && isOriginAllowed(request)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
}

function isAuthorized(request: IncomingMessage): boolean {
  if (!configuredToken) return true;
  return authorizationHeader(request) === `Bearer ${configuredToken}`;
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(payload)}\n`);
}

function sendEmpty(response: ServerResponse, statusCode: number) {
  response.statusCode = statusCode;
  response.end();
}

function parseRequestUrl(request: IncomingMessage) {
  return new URL(request.url ?? "/", `http://${hostHeader(request)}`);
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    request.on("data", (chunk) => {
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_JSON_BODY_BYTES) {
        reject(new Error("Request body is too large"));
        request.socket.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      const text = new TextDecoder().decode(concatBytes(chunks, totalBytes)).trim();
      if (!text) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error("Request body must be valid JSON"));
      }
    });
  });
}

function concatBytes(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function handleHttpRequest(request: IncomingMessage, response: ServerResponse) {
  setCorsHeaders(request, response);

  if (!isOriginAllowed(request)) {
    sendJson(response, 403, { ok: false, error: "Origin is not allowed" });
    return;
  }

  if (request.method === "OPTIONS") {
    sendEmpty(response, 204);
    return;
  }

  const routeMap = routes();
  const url = parseRequestUrl(request);

  if (request.method === "GET" && url.pathname === routeMap.health) {
    sendJson(response, 200, {
      ok: true,
      service: "obsGateway",
      connected: runtimeState.connected,
      auth: authState(),
      server: serverState()
    });
    return;
  }

  if (!isAuthorized(request)) {
    sendJson(response, 401, { ok: false, error: "Bearer token is required" });
    return;
  }

  if (request.method === "GET" && url.pathname === routeMap.snapshot) {
    sendJson(response, 200, snapshot());
    return;
  }

  if (request.method === "GET" && url.pathname === routeMap.stream) {
    openSseStream(response);
    return;
  }

  if (request.method === "POST" && url.pathname === routeMap.configure) {
    try {
      const body = await readJsonBody(request);
      applyConfiguration((body ?? {}) as ConfigureInput);
      await resolveConfiguredToken(serviceContext);
      sendJson(response, 200, snapshot());
      scheduleGatewaySync();
    } catch (error) {
      sendJson(response, 400, { ok: false, error: errorMessage(error) });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === routeMap.connectionState) {
    try {
      const body = await readJsonBody(request);
      applyConnectionState((body ?? {}) as SetConnectionStateInput);
      broadcast(event("connection", snapshot()));
      sendJson(response, 200, snapshot());
    } catch (error) {
      sendJson(response, 400, { ok: false, error: errorMessage(error) });
    }
    return;
  }

  sendJson(response, 404, { ok: false, error: "Route not found" });
}

function openSseStream(response: ServerResponse) {
  const client: SseClient = {
    id: nextClientId++,
    response
  };

  sseClients.set(client.id, client);
  response.writeHead(200, {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-Accel-Buffering": "no"
  });
  response.write(": connected\n\n");
  sendSse(client, event("snapshot", snapshot()));
  response.on("close", () => {
    sseClients.delete(client.id);
  });
}

function handleUpgrade(request: IncomingMessage, socket: Socket) {
  if (!isOriginAllowed(request) || !isAuthorized(request)) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  const routeMap = routes();
  const url = parseRequestUrl(request);
  if (url.pathname !== routeMap.stream && url.pathname !== routeMap.websocket) {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  const keyHeader = request.headers["sec-websocket-key"];
  const key = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;
  if (!key) {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  const accept = createHash("sha1").update(`${key}${WEBSOCKET_GUID}`).digest("base64");
  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "\r\n"
  ].join("\r\n"));

  const client: WebSocketClient = {
    id: nextClientId++,
    socket
  };
  webSocketClients.set(client.id, client);
  sendWebSocket(client, event("snapshot", snapshot()));
  socket.on("close", () => {
    webSocketClients.delete(client.id);
  });
}

async function resolveConfiguredToken(context: PluginRuntimeContext | null) {
  const secretKeyRef = runtimeState.config.secretKeyRef;
  configuredToken = undefined;
  tokenConfigured = false;

  if (!context || !secretKeyRef) return;

  try {
    tokenConfigured = await context.secrets.configured(secretKeyRef);
    configuredToken = tokenConfigured ? await context.secrets.get(secretKeyRef) : undefined;
  } catch (error) {
    tokenConfigured = false;
    configuredToken = undefined;
    runtimeState.lastError = `Unable to resolve OBS gateway secret: ${errorMessage(error)}`;
    context.diagnostics.warn(runtimeState.lastError);
  }
}

async function startGateway() {
  if (gatewayServer || !runtimeState.config.enabled) return;

  const config = runtimeState.config;
  const server = createServer((request, response) => {
    void handleHttpRequest(request, response).catch((error) => {
      response.statusCode = 500;
      response.end(`${JSON.stringify({ ok: false, error: errorMessage(error) })}\n`);
    });
  });
  server.on("upgrade", (request, socket) => handleUpgrade(request, socket));

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("error", onError);
      reject(error);
    };
    server.on("error", onError);
    server.listen(config.listenPort, config.listenAddress, () => {
      server.off("error", onError);
      resolve();
    });
  });

  gatewayServer = server;
  gatewayStartedAtMs = Date.now();
  startHeartbeat();
  runtimeState.lastError = undefined;
  serviceContext?.diagnostics.log(`obs-gateway listening on ${config.listenAddress}:${config.listenPort}`);
  broadcast(event("server", serverState()));
}

async function stopGateway() {
  const server = gatewayServer;
  gatewayServer = null;
  gatewayStartedAtMs = null;
  stopHeartbeat();
  closeClients();

  if (!server) return;

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

async function syncGateway() {
  await resolveConfiguredToken(serviceContext);
  await stopGateway();

  if (!runtimeState.config.enabled) {
    serviceContext?.diagnostics.log("obs-gateway runtime server disabled by settings");
    return;
  }

  try {
    await startGateway();
  } catch (error) {
    runtimeState.lastError = `Unable to start OBS gateway server: ${errorMessage(error)}`;
    serviceContext?.diagnostics.error(runtimeState.lastError);
  }
}

async function configureGateway(input: ConfigureInput) {
  applyConfiguration(input);
  await syncGateway();
  broadcast(event("server", serverState()));
}

function scheduleGatewaySync() {
  setTimeout(() => {
    void syncGateway().then(() => {
      broadcast(event("server", serverState()));
    });
  }, 0);
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default {
  async mount(context: PluginRuntimeContext) {
    serviceContext = context;
    readSettingsAsConfig(context);
    await syncGateway();
    context.diagnostics.log("obs-gateway runtime service mounted");
  },
  async unmount() {
    await stopGateway();
    configuredToken = undefined;
    tokenConfigured = false;
    serviceContext = null;
  },
  methods: {
    async snapshot(): Promise<unknown> {
      return snapshot();
    },
    async configure(input: unknown): Promise<unknown> {
      await configureGateway((input ?? {}) as ConfigureInput);
      return snapshot();
    },
    async setConnectionState(input: unknown): Promise<unknown> {
      applyConnectionState((input ?? {}) as SetConnectionStateInput);
      broadcast(event("connection", snapshot()));
      serviceContext?.diagnostics.log(`obs-gateway connection state set to ${runtimeState.connected}`);
      return snapshot();
    }
  }
} satisfies RuntimeService;
