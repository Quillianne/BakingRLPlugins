#!/usr/bin/env node
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const platform = process.argv[2];
const supported = new Set(["darwin-arm64", "darwin-x64", "linux-x64", "windows-x64"]);
if (!supported.has(platform)) throw new Error(`Unsupported OBS release platform: ${platform ?? "missing"}`);

const rootDir = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(resolve(rootDir, "obs-gateway/bakingrl.plugin.json"), "utf8"));
const source = resolve(rootDir, "obs-gateway/dist-bundles", `${manifest.id}-${manifest.version}.brlp`);
const targetDir = resolve(rootDir, "release-assets");
const target = resolve(targetDir, `${manifest.id}-${manifest.version}-${platform}.brlp`);
mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);
console.log(`Staged ${target}`);
