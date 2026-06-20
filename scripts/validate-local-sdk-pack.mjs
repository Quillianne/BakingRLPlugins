#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sdkDir = resolve(process.env.BAKINGRL_SDK_DIR ?? resolve(rootDir, "../BakingRLSDK"));
const keepWorkdir = process.env.BAKINGRL_KEEP_LOCAL_SDK_WORKDIR === "1";
const tmpRoot = mkdtempSync(resolve(tmpdir(), "bakingrl-local-sdk-pack-"));
const packsDir = resolve(tmpRoot, "packs");
const pluginsDir = resolve(tmpRoot, "BakingRLPlugins");
const generatedDirs = new Set([".cargo-target", ".svelte-kit", "build", "dist", "dist-bundles", "docs-site"]);
const baseEnv = {
  ...process.env,
  npm_config_audit: "false",
  npm_config_cache: resolve(tmpRoot, "npm-cache"),
  npm_config_fund: "false",
  npm_config_logs_dir: resolve(tmpRoot, "npm-logs"),
  npm_config_update_notifier: "false"
};

mkdirSync(packsDir, { recursive: true });
mkdirSync(baseEnv.npm_config_cache, { recursive: true });
mkdirSync(baseEnv.npm_config_logs_dir, { recursive: true });

function fail(message) {
  throw new Error(message);
}

function commandLine(command, args) {
  return [command, ...args].join(" ");
}

function run(command, args, options = {}) {
  console.log(`> ${commandLine(command, args)}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? rootDir,
    env: options.env ?? process.env,
    stdio: "inherit"
  });
  if (result.error) fail(`${commandLine(command, args)} failed: ${result.error.message}`);
  if (result.status !== 0) fail(`${commandLine(command, args)} exited with ${result.status ?? result.signal}`);
}

function runCapture(command, args, options = {}) {
  console.log(`> ${commandLine(command, args)}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? rootDir,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) fail(`${commandLine(command, args)} failed: ${result.error.message}`);
  if (result.status !== 0) fail(`${commandLine(command, args)} exited with ${result.status ?? result.signal}`);
  return result.stdout;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function shouldCopy(src) {
  const rel = relative(rootDir, src);
  if (!rel) return true;

  const parts = rel.split(sep);
  if (parts[0] === ".git") return false;
  if (parts[0] === "node_modules") {
    return !parts.includes(".cache") && !parts.includes(".vite");
  }
  return !parts.some((part) => generatedDirs.has(part));
}

function copyPluginsWorkspace() {
  console.log(`Copying plugin workspace to ${pluginsDir}`);
  cpSync(rootDir, pluginsDir, {
    recursive: true,
    dereference: false,
    filter: shouldCopy
  });
}

function packPackage(packageDir) {
  const before = new Set(readdirSync(packsDir));
  const stdout = runCapture("npm", ["pack", "--pack-destination", packsDir], { cwd: packageDir, env: baseEnv });
  const created = readdirSync(packsDir).filter((item) => item.endsWith(".tgz") && !before.has(item));
  const stdoutTarball = stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .findLast((line) => line.endsWith(".tgz"));
  const tarball = created[0] ?? stdoutTarball;
  if (!tarball) fail(`npm pack did not create a tarball for ${packageDir}.`);
  return resolve(packsDir, basename(tarball));
}

function unpackPackage(tarball, packageName) {
  const targetDir = resolve(pluginsDir, "node_modules/@bakingrl", packageName);
  const extractDir = mkdtempSync(resolve(tmpRoot, `extract-${packageName}-`));
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(dirname(targetDir), { recursive: true });
  run("tar", ["-xzf", tarball, "-C", extractDir]);
  cpSync(resolve(extractDir, "package"), targetDir, { recursive: true, dereference: false });
  rmSync(extractDir, { recursive: true, force: true });
}

function ensureBin(name, target) {
  const binDir = resolve(pluginsDir, "node_modules/.bin");
  const binPath = resolve(binDir, name);
  mkdirSync(binDir, { recursive: true });
  rmSync(binPath, { force: true });
  symlinkSync(target, binPath, "file");
}

function assertPackedPackagesInstalled() {
  const sdkPackage = readJson(resolve(pluginsDir, "node_modules/@bakingrl/plugin-sdk/package.json"));
  const cliPackage = readJson(resolve(pluginsDir, "node_modules/@bakingrl/create-plugin/package.json"));
  const sdkEntry = resolve(pluginsDir, "node_modules/@bakingrl/plugin-sdk/dist/index.js");
  const cliEntry = resolve(pluginsDir, "node_modules/@bakingrl/create-plugin/lib/bakingrl-plugin.mjs");

  if (!existsSync(sdkEntry)) fail(`Packed plugin SDK entry is missing: ${sdkEntry}`);
  if (!existsSync(cliEntry)) fail(`Packed create-plugin helper is missing: ${cliEntry}`);
  if (lstatSync(resolve(pluginsDir, "node_modules/@bakingrl/plugin-sdk")).isSymbolicLink()) {
    fail("Packed plugin SDK must be installed as a package copy, not a workspace symlink.");
  }
  if (lstatSync(resolve(pluginsDir, "node_modules/@bakingrl/create-plugin")).isSymbolicLink()) {
    fail("Packed create-plugin helper must be installed as a package copy, not a workspace symlink.");
  }

  console.log(`Using local packs: ${sdkPackage.name}@${sdkPackage.version}, ${cliPackage.name}@${cliPackage.version}`);
}

function runPluginValidation() {
  const env = {
    ...baseEnv,
    BAKINGRL_HOST_DIR: process.env.BAKINGRL_HOST_DIR ?? resolve(rootDir, "../BakingRL"),
    BAKINGRL_POC_ROOT_DIR: pluginsDir,
    BAKINGRL_SDK_DIR: sdkDir,
    PATH: `${resolve(pluginsDir, "node_modules/.bin")}:${process.env.PATH ?? ""}`
  };
  const commands = [
    ["npm", ["run", "check"]],
    ["npm", ["run", "build"]],
    ["npm", ["run", "validate"]],
    ["npm", ["run", "validate:poc-chain"]],
    ["npm", ["run", "validate:runtime-poc"]],
    ["npm", ["run", "validate:local-install"]]
  ];

  for (const [command, args] of commands) {
    run(command, args, { cwd: pluginsDir, env });
  }
}

try {
  if (!existsSync(resolve(sdkDir, "packages/plugin-sdk/package.json"))) {
    fail(`BakingRLSDK directory not found. Set BAKINGRL_SDK_DIR if needed: ${sdkDir}`);
  }
  if (!existsSync(resolve(rootDir, "node_modules"))) {
    fail("BakingRLPlugins node_modules is required. Run npm install before validate:local-sdk-pack.");
  }

  run("npm", ["run", "build", "--workspace", "@bakingrl/plugin-sdk"], { cwd: sdkDir, env: baseEnv });
  const sdkPack = packPackage(resolve(sdkDir, "packages/plugin-sdk"));
  const cliPack = packPackage(resolve(sdkDir, "packages/create-bakingrl-plugin"));

  copyPluginsWorkspace();
  unpackPackage(sdkPack, "plugin-sdk");
  unpackPackage(cliPack, "create-plugin");
  ensureBin("bakingrl-plugin", "../@bakingrl/create-plugin/lib/bakingrl-plugin.mjs");
  ensureBin("create-bakingrl-plugin", "../@bakingrl/create-plugin/bin/create-bakingrl-plugin.mjs");
  assertPackedPackagesInstalled();
  runPluginValidation();
  console.log("Local SDK pack validation passed.");
} finally {
  if (keepWorkdir) {
    console.log(`Keeping local SDK pack workdir: ${tmpRoot}`);
  } else {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}
