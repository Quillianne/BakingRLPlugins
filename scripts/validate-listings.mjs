#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const rootPackage = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8"));
let validated = 0;

for (const workspace of rootPackage.workspaces) {
  const manifestPath = resolve(rootDir, workspace, "bakingrl.plugin.json");
  const listingPath = resolve(rootDir, workspace, "marketplace/listing.json");
  if (!existsSync(manifestPath) || !existsSync(listingPath)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const listing = JSON.parse(readFileSync(listingPath, "utf8"));
  assert.equal(listing.schema, "bakingrl.plugin-listing/1", `${workspace} listing schema is invalid.`);
  assert.equal(listing.packageId, manifest.id, `${workspace} listing packageId must match its manifest.`);
  for (const field of ["displayName", "shortDescription", "longDescription", "repo"]) {
    assert.equal(typeof listing[field], "string", `${workspace} listing ${field} is required.`);
    assert.ok(listing[field].trim(), `${workspace} listing ${field} must not be empty.`);
  }
  assert.ok(Array.isArray(listing.tags), `${workspace} listing tags must be an array.`);
  validated += 1;
}

assert.ok(validated > 0, "No marketplace listings were found.");
console.log(`Validated ${validated} plugin marketplace listing(s).`);
