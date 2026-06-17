# POC Simple Node

Validation package for the BakingRL 2.1 plugin runtime.

- Runs a Node extension.
- Reads the latest Rocket League snapshot, falling back to an SDK mock snapshot.
- Exposes `ping`, `snapshot`, and `debugState` service methods.
- Writes a small debug state entry through the host-owned plugin state API.
