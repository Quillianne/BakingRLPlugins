# OBS Gateway

Trusted first-party service package that prepares the BakingRL OBS gateway.

The current package exposes a V4 node runtime service named `obsGateway`. It
keeps local gateway configuration and connection state without opening network
routes by itself. Host OBS primitives will own the actual route binding,
authentication, and event forwarding once that runtime contract is available.

## Exports

- Service `obsGateway`
- Methods: `snapshot`, `configure`, `setConnectionState`
- Package settings schema: `src/settings.schema.json`

## Settings

The settings schema stores only non-secret gateway metadata, including listen
address, listen port, route prefix, stream path, heartbeat interval, allowed
origins, and a `secretKeyRef`.

`secretKeyRef` is a host secret-store key reference. It must never contain the
secret value itself.
