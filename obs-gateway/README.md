# OBS Gateway

OBS Gateway serves Layout Studio documents to OBS browser sources through a
local Rust HTTP sidecar.

The local gateway listens on `http://127.0.0.1:17844` by default. This dedicated
port avoids conflicting with OBS WebSocket; it can be changed from the plugin
settings when another local service already uses it.

## Contract

The Node extension depends on Layout Studio, calls
`bakingrl.layout-studio/layoutStudio.snapshot`, and refreshes the sidecar when
`plugin.bakingrl.layout-studio.changed` is published. It does not synthesize
layouts from installed resources.

The `obsGateway` service exposes `snapshot`, `configure`,
`setConnectionState`, `refreshHostData` and `updateHostData`. The
`obsGatewayConfig` settings webview owns gateway configuration.

## Routes

- `GET /overlay/health`
- `GET /overlay/stream`
- `GET /overlay/layouts/:layoutId`
- `GET /overlay/api/gateway`
- `GET /overlay/api/layouts`
- `GET /overlay/api/layouts/:layoutId`
- `GET /overlay/api/snapshot`
- `GET /overlay/api/events`
- `GET /overlay/api/events/ws`

The stream and layout routes render the saved Layout Studio layers, native
items and public visual modules.

## Security

Settings contain only non-secret metadata. `secretKeyRef` points to the host
secret store. Local addresses do not require a token by default; non-local
binds and explicit `requireToken` settings require authentication. Allowed
origins are checked before route handling.

## Build

```sh
npm run build
```

The platform sidecar is copied to the manifest path
`bin/obs-gateway-sidecar.exe`. The suffix is retained on every platform so the
same manifest path remains directly executable on Windows; generated binaries
and bundles are not committed.
