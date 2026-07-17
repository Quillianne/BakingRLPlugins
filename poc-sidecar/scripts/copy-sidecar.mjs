import { copyFileSync, chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const exe = process.platform === "win32" ? ".exe" : "";
const source = resolve(`../.cargo-target/poc-sidecar/release/poc-sidecar-worker${exe}`);
const target = resolve("bin/poc-sidecar");

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
if (process.platform !== "win32") chmodSync(target, 0o755);
console.log(`Copied sidecar to ${target}`);
