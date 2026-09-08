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
assert.match(readme, /Every turn\. Every tool\. Every token\./u);
for (const asset of ["demo.svg", "demo-mobile.svg", "gallery.webp", "gallery-mobile.webp"]) {
	assert.ok(existsSync(join(root, "media", asset)), `README gallery asset is missing: ${asset}`);
}
for (const source of ["demo.svg", "demo-mobile.svg"]) {
	const svg = readFileSync(join(root, "media", source), "utf8");
	assert.match(svg, /real Pi 0\.85\.1 TUI session/u);
	assert.match(svg, /Pi TimeLens · faithful(?: .*?)? transcript · (?:120|40) columns/u);
	assert.doesNotMatch(svg, /tok —|✓ read/u, `${source} must not restore illustrative tool output`);
}
for (const capture of ["real-pi-120.txt", "real-pi-40.txt"]) {
	assert.ok(existsSync(join(root, "tests", "fixtures", capture)), `capture evidence is missing: ${capture}`);
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
