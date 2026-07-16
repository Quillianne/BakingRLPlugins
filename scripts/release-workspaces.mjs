#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const npmCliPath = process.env.npm_execpath;
const npmExecutable = npmCliPath ? process.execPath : "npm";
const [command, ...rawArgs] = process.argv.slice(2);
if (!command) throw new Error("Usage: release-workspaces.mjs <workspace-script> [...args]");

const portableOnly = rawArgs.includes("--portable-only");
const signFromEnv = rawArgs.includes("--sign-from-env");
const workspaceIndex = rawArgs.indexOf("--workspace");
const selectedWorkspace = workspaceIndex >= 0 ? rawArgs[workspaceIndex + 1] : null;
const commandArgs = rawArgs.filter((value, index) =>
  value !== "--portable-only"
  && value !== "--sign-from-env"
  && value !== "--workspace"
  && (workspaceIndex < 0 || index !== workspaceIndex + 1)
);
if (signFromEnv) {
  const keyPath = process.env.BAKINGRL_PLUGIN_SIGNING_KEY;
  if (!keyPath) throw new Error("BAKINGRL_PLUGIN_SIGNING_KEY is required.");
  commandArgs.push("--sign", keyPath);
}

const rootPackage = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8"));
const releaseWorkspaces = rootPackage.workspaces.filter((workspace) => {
  if (!existsSync(resolve(rootDir, workspace, "marketplace/listing.json"))) return false;
  if (selectedWorkspace && workspace !== selectedWorkspace) return false;
  if (!portableOnly) return true;
  const manifest = JSON.parse(readFileSync(resolve(rootDir, workspace, "bakingrl.plugin.json"), "utf8"));
  return (manifest.runtime?.sidecars ?? []).length === 0;
});

if (releaseWorkspaces.length === 0) throw new Error("No marketplace plugin workspaces found.");

for (const workspace of releaseWorkspaces) {
  const args = ["run", command, "--workspace", workspace];
  if (commandArgs.length > 0) args.push("--", ...commandArgs);
  console.log(`> npm ${args.join(" ")}`);
  const spawnArgs = npmCliPath ? [npmCliPath, ...args] : args;
  const result = spawnSync(npmExecutable, spawnArgs, {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Ran ${command} for ${releaseWorkspaces.length} marketplace plugin workspace(s).`);
