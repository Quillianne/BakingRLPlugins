# OBS Gateway

Trusted first-party sidecar package that runs the BakingRL OBS gateway.

The package exposes a V4 sidecar runtime service named `obsGateway`. A tiny
Node activation module reads host-owned package settings and secrets, then
configures the Rust sidecar. The Rust process owns the local HTTP gateway and
keeps OBS-facing connection state inside the plugin boundary. It does not
reintroduce OBS core logic in the host.

## Exports

- Sidecar `gateway`
- Service `obsGateway` backed by `sidecar:gateway`
- Methods: `snapshot`, `configure`, `setConnectionState`
- Package settings schema: `src/settings.schema.json`

## Runtime gateway

When enabled, the sidecar starts a Rust HTTP server on `listenAddress` and
`listenPort`.

Default routes:

- `GET /overlay/health`: liveness and public server metadata.
- `GET /overlay/snapshot`: current gateway config, auth metadata, server state,
  and connection state.
- `GET /overlay/stream`: Server-Sent Events stream for internal gateway events.
- `GET /overlay/stream/ws`: WebSocket stream for the same JSON events.
- `POST /overlay/configure`: authenticated runtime reconfiguration.
- `POST /overlay/connection-state`: authenticated connection-state update.

The WebSocket stream also accepts an upgrade request on `/overlay/stream`.

## Settings

The settings schema stores only non-secret gateway metadata, including listen
address, listen port, route prefix, stream path, heartbeat interval, allowed
origins, and a `secretKeyRef`.

`secretKeyRef` is a host secret-store key reference. It must never contain the
secret value itself. If `context.secrets.configured(secretKeyRef)` is true and
the host returns a token, all routes except health require
`Authorization: Bearer <token>`.

Origins are checked before route handling. Exact origins are accepted; entries
such as `http://localhost` also allow any port for that host.

## Sidecar build

The package builds the Rust sidecar before the extension bundle:

```sh
npm run build
```

The compiled binary is copied to `bin/obs-gateway-sidecar`, which is the path
declared in `bakingrl.plugin.json`. Build outputs under `bin/` and
`sidecar/target/` are intentionally not committed.
