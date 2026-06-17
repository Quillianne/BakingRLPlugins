# OBS Gateway

Trusted first-party service package that runs the BakingRL OBS gateway.

The current package exposes a V4 node runtime service named `obsGateway`. It
starts a local HTTP gateway from package settings and keeps OBS-facing
connection state inside the plugin boundary. It does not reintroduce OBS core
logic in the host.

## Exports

- Service `obsGateway`
- Methods: `snapshot`, `configure`, `setConnectionState`
- Package settings schema: `src/settings.schema.json`

## Runtime gateway

When enabled, the service starts a Node HTTP server on `listenAddress` and
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
