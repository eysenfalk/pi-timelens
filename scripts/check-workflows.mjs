import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const workflowDirectory = join(root, ".github/workflows");
const workflowFiles = readdirSync(workflowDirectory).filter((file) => /\.ya?ml$/u.test(file));
assert.ok(workflowFiles.length >= 3, "expected CI, release, and CodeQL workflows");

for (const file of workflowFiles) {
	const content = readFileSync(join(workflowDirectory, file), "utf8");
	assert.doesNotMatch(content, /pull_request_target:/u, `${file} must not execute pull_request_target code`);
	for (const match of content.matchAll(/^\s*uses:\s*([^\s#]+).*$/gmu)) {
		const action = match[1];
		assert.match(action, /@[0-9a-f]{40}$/u, `${file} action is not pinned to a full commit: ${action}`);
	}
}

const ci = readFileSync(join(workflowDirectory, "ci.yml"), "utf8");
assert.match(ci, /node:\s*\[22, 24\]/u);
assert.match(ci, /npm ci --ignore-scripts/u);
assert.match(ci, /npm run smoke:packed/u);

const release = readFileSync(join(workflowDirectory, "release.yml"), "utf8");
assert.match(release, /release:\s*\n\s*types:\s*\[published\]/u);
assert.match(release, /id-token:\s*write/u);
assert.match(release, /environment:\s*npm/u);
assert.match(release, /node-version:\s*24/u);
assert.match(release, /npm install --global npm@12\.0\.2/u);
assert.match(release, /verify-release-tag\.mjs/u);
assert.match(release, /npm publish --access public --provenance/u);

console.log(`Workflow contract OK: ${workflowFiles.length} workflows with immutable action pins`);
