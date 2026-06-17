import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const exe = process.platform === "win32" ? ".exe" : "";
const source = join(root, "..", ".cargo-target", "obs-gateway", "release", `obs-gateway-sidecar${exe}`);
const target = join(root, "bin", `obs-gateway-sidecar${exe}`);

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`Copied ${source} -> ${target}`);
