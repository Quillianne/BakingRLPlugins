# OBS Gateway

Trusted first-party sidecar package that runs the BakingRL OBS gateway.

The package exposes a V4 service named `obsGateway`. The Node activation module
reads host-owned package settings/secrets, refreshes host layout metadata when
the host API is available, and proxies service calls to the Rust sidecar. The
Rust process owns the local HTTP gateway and keeps OBS-facing connection state
inside the plugin boundary. It does not reintroduce OBS core logic in the host.

## Exports

- Sidecar `gateway`
- Service `obsGateway` backed by the Node extension, proxying to sidecar
- Methods: `snapshot`, `configure`, `setConnectionState`, `refreshHostData`,
  `updateHostData`
- Package settings schema: `src/settings.schema.json`
- Settings UI visual `obsGatewayConfig` (`kind: "config"`)

## Runtime gateway

When enabled, the sidecar starts a Rust HTTP server on `listenAddress` and
`listenPort`.

Default routes:

- `GET /overlay/health`: liveness and public server metadata.
- `GET /overlay/stream`: OBS browser page for the selected stream layout.
- `GET /overlay/layouts/:layoutId`: OBS browser page for a specific layout.
- `GET /overlay/api/gateway`: current gateway config, auth metadata, server
  state, host layout metadata, and connection state.
- `GET /overlay/api/layouts`: detected host layouts and copy-ready layout URLs.
- `GET /overlay/api/layouts/:layoutId`: one detected layout.
- `GET /overlay/api/snapshot`: latest host-provided snapshot when available.
- `GET /overlay/api/events`: Server-Sent Events stream for internal gateway
  events.
- `GET /overlay/api/events/ws`: WebSocket stream for the same JSON events.
- `POST /overlay/api/configure`: reserved; runtime reconfiguration must go
  through the BakingRL service method.
- `POST /overlay/api/connection-state`: authenticated connection-state update.

`GET /overlay/snapshot` remains as a compatibility alias for
`GET /overlay/api/gateway`.

## Settings

The settings schema stores only non-secret gateway metadata, including listen
address, listen port, route prefix, stream path, heartbeat interval, allowed
origins, selected `streamLayoutId`, local `requireToken`, and a `secretKeyRef`.

`secretKeyRef` is a host secret-store key reference. It must never contain the
secret value itself.

OBS URLs do not include or require a token by default when `listenAddress` is
local (`localhost`, `127.*`, or `::1`). If the gateway binds to a non-local
address, or if `requireToken` is enabled, routes except health require the
configured token. Browser-source friendly URLs then include `?token=...`; API
clients may also use `Authorization: Bearer <token>`.

Origins are checked before route handling. Exact origins are accepted; entries
such as `http://localhost` also allow any port for that host.

## Host layout and snapshot contract

Runtime API 2.2 no longer exposes host-owned overlay layout discovery. The Node
extension now reports an empty `host.layouts` list with an explicit message so
the gateway can still run while platform plugins own future layout contracts.

There is not yet a dedicated host API in the SDK for layout render snapshots.
Until the host exposes one, `/overlay/api/snapshot` returns HTTP 501 with:

```json
{
  "ok": false,
  "expectedHostContract": {
    "extensionApi": "Provide a host overlay/layout snapshot API reachable from ExtensionContext.",
    "pluginMethod": "obsGateway.updateHostData({ layouts, snapshot, hostApiAvailable })",
    "apiEndpoint": "GET /overlay/api/snapshot returns the latest host-provided snapshot once available."
  }
}
```

Once the host can provide snapshots, the extension should call the existing
sidecar method:

```ts
context.sidecars.call("gateway", "updateHostData", {
  layouts,
  snapshot,
  hostApiAvailable: true
});
```

## Sidecar build

The package builds the Rust sidecar before the extension bundle:

```sh
npm run build
```

The compiled binary is copied to `bin/obs-gateway-sidecar`, which is the path
declared in `bakingrl.plugin.json`. Build outputs under `bin/` and
`sidecar/target/` are intentionally not committed.
