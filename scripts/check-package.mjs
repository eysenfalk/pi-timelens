import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

assert.equal(manifest.name, "pi-timelens");
assert.equal(manifest.license, "MIT");
assert.ok(manifest.keywords.includes("pi-package"), "package must remain discoverable in the Pi gallery");
assert.deepEqual(manifest.pi.extensions, ["./extensions/pi-timelens/index.ts"]);
assert.ok(manifest.pi.image.startsWith("https://"), "gallery image must use HTTPS");
assert.ok(
	!manifest.scripts?.install && !manifest.scripts?.postinstall && !manifest.scripts?.prepare,
	"runtime install hooks are forbidden",
);
assert.equal(manifest.dependencies, undefined, "Pi TimeLens must remain free of runtime dependencies");

const runtimeFiles = ["commands.ts", "core.ts", "index.ts", "reporting.ts", "runtime.ts", "settings.ts"];
const runtimeSource = runtimeFiles
	.map((file) => readFileSync(join(root, "extensions/pi-timelens", file), "utf8"))
	.join("\n");
for (const [label, pattern] of [
	["network fetch", /\bfetch\s*\(/u],
	["web socket", /\bWebSocket\b/u],
	["child process", /node:child_process/u],
	["model message injection", /\bsendMessage\s*\(/u],
]) {
	assert.doesNotMatch(runtimeSource, pattern, `runtime source must not contain ${label}`);
}

for (const relativePath of manifest.pi.extensions) {
	assert.ok(existsSync(resolve(root, relativePath)), `missing Pi extension: ${relativePath}`);
}

const packed = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
	cwd: root,
	encoding: "utf8",
	timeout: 30_000,
});
assert.equal(packed.status, 0, packed.stderr || "npm pack --dry-run failed");
const packOutput = JSON.parse(packed.stdout);
const report = Array.isArray(packOutput) ? packOutput[0] : (packOutput[manifest.name] ?? Object.values(packOutput)[0]);
assert.ok(report && typeof report === "object", "npm pack returned no package report");
assert.ok(report.files.length > 0, "npm tarball would be empty");
assert.ok(report.unpackedSize < 500_000, `npm tarball is unexpectedly large: ${report.unpackedSize} bytes`);

const paths = report.files.map((file) => file.path);
const forbidden = paths.filter((path) =>
	/(^|\/)(tests?|scripts?|\.github|PROJECT_PLAN\.md|AGENTS\.md|node_modules|coverage|\.env)/i.test(path),
);
assert.deepEqual(forbidden, [], `private or development-only files would be published: ${forbidden.join(", ")}`);

const required = [
	"package.json",
	"README.md",
	"LICENSE",
	"CHANGELOG.md",
	"SECURITY.md",
	"extensions/pi-timelens/index.ts",
	"extensions/pi-timelens/core.ts",
	"extensions/pi-timelens/runtime.ts",
	"extensions/pi-timelens/reporting.ts",
	"extensions/pi-timelens/settings.ts",
	"extensions/pi-timelens/commands.ts",
	"docs/architecture.md",
	"docs/development-workflow.md",
	"docs/commands.md",
	"docs/integrations.md",
	"docs/metrics.md",
	"docs/privacy.md",
	"media/demo.svg",
	"media/demo-mobile.svg",
	"media/gallery.webp",
	"media/gallery-mobile.webp",
];
for (const path of required) assert.ok(paths.includes(path), `npm tarball is missing ${path}`);

console.log(`Package contract OK: ${paths.length} files, ${report.unpackedSize} unpacked bytes`);
