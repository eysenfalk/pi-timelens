import assert from "node:assert/strict";
import test from "node:test";
import { registerTimingCommands } from "../extensions/pi-timelens/commands.ts";
import { DEFAULT_TIMING_SETTINGS, type TimingSettings } from "../extensions/pi-timelens/settings.ts";

function harness() {
	let command: ((args: string, ctx: any) => unknown) | undefined;
	let settings: TimingSettings = { ...DEFAULT_TIMING_SETTINGS };
	const panels: string[][] = [];
	const notifications: Array<{ message: string; level?: string }> = [];
	const exports: Array<{ format: string; content: string }> = [];
	const entries = [
		{
			type: "custom",
			customType: "message-timing",
			data: {
				schemaVersion: 2,
				cycleId: "cycle",
				sequence: 1,
				kind: "cycle",
				startedAt: 0,
				endedAt: 100,
				durationMs: 100,
				assistantDurationMs: 80,
				toolWallMs: 0,
				toolWorkMs: 0,
				assistantSteps: 1,
				toolCalls: 0,
				toolFailures: 0,
				toolAborts: 0,
				submissions: 1,
				userWaitMs: 0,
				retryWaitMs: 0,
				totalUsage: {
					input: 100,
					output: 20,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 120,
					cost: { input: 0.01, output: 0.01, cacheRead: 0, cacheWrite: 0, total: 0.02 },
				},
				billingMode: "metered",
				status: "success",
			},
		},
	];
	const ctx = {
		sessionManager: { getBranch: () => entries },
		ui: {
			notify(message: string, level?: string) {
				notifications.push({ message, level });
			},
		},
	};
	registerTimingCommands(
		{
			registerCommand(_name: string, definition: { handler: (args: string, ctx: any) => unknown }) {
				command = definition.handler;
			},
		} as never,
		{
			getSettings: () => settings,
			saveSettings(next) {
				settings = next;
			},
			showPanel(_ctx, _title, lines) {
				panels.push(lines);
			},
			writeExport(format, content) {
				exports.push({ format, content });
				return `/safe/timing.${format}`;
			},
		},
	);
	assert.ok(command);
	return { command: command!, settings: () => settings, panels, notifications, exports, ctx };
}

test("dispatches English summary, timeline, legend, and help panels", async () => {
	const h = harness();
	for (const action of ["summary", "timeline", "legend", "help"]) await h.command(action, h.ctx);
	assert.equal(h.panels.length, 4);
	assert.match(h.panels[0]!.join("\n"), /current branch/);
	assert.match(h.panels[1]!.join("\n"), /timeline/);
	assert.match(h.panels[2]!.join("\n"), /cache-read/);
	assert.match(h.panels[2]!.join("\n"), /omit redundant subscription labels/);
	assert.match(h.panels[3]!.join("\n"), /Pi TimeLens/);
});

test("cost-off settings also hide prices in summaries", async () => {
	const h = harness();
	await h.command("summary", h.ctx);
	assert.match(h.panels.at(-1)?.join("\n") ?? "", /Cost\s+\$0\.0200/);
	await h.command("settings cost off", h.ctx);
	await h.command("summary", h.ctx);
	assert.doesNotMatch(h.panels.at(-1)?.join("\n") ?? "", /Cost\s+\$/);
});

test("persists valid settings and rejects invalid values", async () => {
	const h = harness();
	await h.command("settings live off", h.ctx);
	assert.equal(h.settings().live, false);
	assert.match(h.notifications.at(-1)?.message ?? "", /updated/);
	await h.command("settings display huge", h.ctx);
	assert.match(h.notifications.at(-1)?.message ?? "", /compact, detailed, or off/);
});

test("writes safe JSON and CSV exports through the injected sink", async () => {
	const h = harness();
	await h.command("export json", h.ctx);
	await h.command("export csv", h.ctx);
	assert.deepEqual(
		h.exports.map((item) => item.format),
		["json", "csv"],
	);
	assert.match(h.exports[0]!.content, /current-branch/);
	assert.match(h.exports[1]!.content, /schemaVersion/);
	assert.match(h.notifications.at(-1)?.message ?? "", /^Timing export written/);
});
