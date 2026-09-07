import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const tag = process.argv[2];
assert.ok(tag, "Usage: node scripts/verify-release-tag.mjs vX.Y.Z");
const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"));
assert.match(tag, /^v\d+\.\d+\.\d+$/u, "release tag must be an exact vMAJOR.MINOR.PATCH version");
assert.equal(tag, `v${manifest.version}`, `release tag ${tag} does not match package version ${manifest.version}`);
console.log(`Release tag ${tag} matches package version ${manifest.version}`);
