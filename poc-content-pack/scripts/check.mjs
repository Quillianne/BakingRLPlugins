import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const manifest = JSON.parse(readFileSync("bakingrl.plugin.json", "utf8"));
const resources = manifest.contributes?.resources ?? [];
for (const resource of resources) {
  const paths = resource.path ? [resource.path] : resource.paths ?? [];
  for (const resourcePath of paths) {
    const fullPath = resolve(resourcePath);
    if (!existsSync(fullPath)) {
      console.error(`Missing resource: ${resourcePath}`);
      process.exit(1);
    }
  }
}
console.log("POC Content Pack resources are present.");
