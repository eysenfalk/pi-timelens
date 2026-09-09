import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const markdown = collectMarkdown(root);
const broken = [];
for (const path of markdown) {
	const content = readFileSync(path, "utf8");
	for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
		const target = match[1].trim().split("#", 1)[0];
		if (!target || /^(?:https?:|mailto:)/u.test(target)) continue;
		if (!existsSync(resolve(dirname(path), decodeURIComponent(target)))) broken.push(`${path}: ${target}`);
	}
}
assert.deepEqual(broken, [], `broken local Markdown links:\n${broken.join("\n")}`);

const readme = readFileSync(join(root, "README.md"), "utf8");
assert.match(readme, /pi install npm:pi-timelens/u);
assert.match(readme, /Know where the time and tokens went\./u);
assert.match(readme, /one concise \*\*Step\*\*/u);
assert.match(readme, /response-stream latency/u);
assert.match(readme, /strict text TTFT/u);
assert.match(readme, /provider-reported reasoning tokens/u);
assert.match(readme, /Reasoning tokens are already included in provider output and total tokens/u);
assert.match(readme, /docs\/development-workflow\.md/u);
assert.doesNotMatch(readme, / · subscription/u, "README compact examples must omit subscription labels");
for (const asset of ["demo.svg", "demo-mobile.svg", "gallery.webp", "gallery-mobile.webp"]) {
	assert.ok(existsSync(join(root, "media", asset)), `README gallery asset is missing: ${asset}`);
}
for (const source of ["demo.svg", "demo-mobile.svg"]) {
	const svg = readFileSync(join(root, "media", source), "utf8");
	assert.match(svg, /real Pi 0\.85\.1 TUI session/u);
	assert.match(svg, /Pi TimeLens · faithful(?: .*?)? transcript · (?:120|40) columns/u);
	assert.match(svg, /footer, model identifier, filesystem path, and assistant reasoning are omitted/u);
	assert.match(svg, /◆ Step/u, `${source} must show the compact Step UX`);
	assert.match(svg, /response/u, `${source} must show response latency`);
	assert.match(svg, /ttft/u, `${source} must show strict text TTFT`);
	assert.doesNotMatch(svg, /◆ Step[^<]*\bfirst\b/u, `${source} must not label first output as TTFT`);
	assert.doesNotMatch(svg, /\b(?:sub|subscription)\b/u, `${source} must omit compact subscription labels`);
	assert.doesNotMatch(
		svg,
		/◆ Batch|└ sent|tok —|✓ read|\d+\. read/u,
		`${source} must not restore redundant compact timing rows`,
	);
}
for (const capture of ["real-pi-120.txt", "real-pi-40.txt"]) {
	const capturePath = join(root, "tests", "fixtures", capture);
	assert.ok(existsSync(capturePath), `capture evidence is missing: ${capture}`);
	const captureText = readFileSync(capturePath, "utf8");
	assert.match(captureText, /footer, model identifier, filesystem path, and assistant reasoning/u);
	assert.match(captureText, /response/u, `${capture} must preserve response latency`);
	assert.match(captureText, /ttft/u, `${capture} must preserve strict text TTFT`);
	assert.doesNotMatch(captureText, /◆ Step[^\n]*\bfirst\b/u, `${capture} must not label first output as TTFT`);
	assert.doesNotMatch(captureText, /\b(?:sub|subscription)\b/u, `${capture} must omit compact subscription labels`);
}
const workflow = readFileSync(join(root, "docs/development-workflow.md"), "utf8");
for (const marker of [
	"PI_TUI_WRITE_LOG",
	"ptyCols: 120",
	"ptyCols: 40",
	"real-pi-120.txt",
	"real-pi-40.txt",
	"faithful Pi transcript redraws",
	"npm run smoke:packed",
	"no automated ANSI replay",
	"does **not** prove line-for-line SVG fidelity",
]) {
	assert.ok(workflow.includes(marker), `development workflow is missing: ${marker}`);
}
const ignore = readFileSync(join(root, ".gitignore"), "utf8");
for (const pattern of [".artifacts/", "*.ansi"]) {
	assert.ok(ignore.split("\n").includes(pattern), `raw capture ignore is missing: ${pattern}`);
}

console.log(`Documentation contract OK: ${markdown.length} Markdown files, no broken local links`);

function collectMarkdown(directory) {
	const results = [];
	for (const entry of readdirSync(directory)) {
		if (entry === "node_modules" || entry === ".git") continue;
		const path = join(directory, entry);
		const stat = statSync(path);
		if (stat.isDirectory()) results.push(...collectMarkdown(path));
		else if (entry.endsWith(".md")) results.push(path);
	}
	return results;
}
