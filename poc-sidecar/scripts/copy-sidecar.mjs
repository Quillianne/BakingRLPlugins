import { copyFileSync, chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const source = resolve("../.cargo-target/poc-sidecar/release/poc-sidecar-worker");
const target = resolve("bin/poc-sidecar");

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
chmodSync(target, 0o755);
console.log(`Copied sidecar to ${target}`);
