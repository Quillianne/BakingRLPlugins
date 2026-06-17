# POC Sidecar

Validation package for managed native sidecars.

- Declares a manual JSON-RPC stdio sidecar.
- Adds a `healthCheck` declaration for the 2.1 host contract.
- Exposes Node-mediated `ping`, `health`, and `crash` service methods.
- Also declares the sidecar service directly as `pocSidecarNative`.
