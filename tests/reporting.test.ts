import assert from "node:assert/strict";
import test from "node:test";
import { formatTimingRecord, type TimingRecord, type ToolTimingRecord } from "../extensions/pi-timelens/core.ts";
import {
	exportTimingCsv,
	exportTimingJson,
	formatSummary,
	formatTimeline,
	summarizeTiming,
	timingRecordsFromEntries,
} from "../extensions/pi-timelens/reporting.ts";
import { formatSettings, normalizeSettings, updateSetting } from "../extensions/pi-timelens/settings.ts";

const base = { schemaVersion: 2 as const, cycleId: "cycle-1", sequence: 1 };
const tool = (
	id: string,
	name: string,
	durationMs: number,
	status: ToolTimingRecord["status"] = "success",
): ToolTimingRecord => ({
	...base,
	kind: "tool",
	turnIndex: 0,
	toolCallId: id,
	toolName: name,
	startedAt: 1_000,
	endedAt: 1_000 + durationMs,
	durationMs,
	billingMode: "unknown",
	status,
});

const records: TimingRecord[] = [
	{
		...base,
		kind: "assistant",
		turnIndex: 0,
		startedAt: 1_000,
		endedAt: 2_000,
		durationMs: 1_000,
		ttftMs: 200,
		streamingMs: 800,
		outputTokensPerSecond: 50,
		usage: {
			input: 100,
			output: 40,
			cacheRead: 500,
			cacheWrite: 10,
			totalTokens: 650,
			cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
		},
		billingMode: "metered",
	},
	{
		...base,
		sequence: 2,
		kind: "batch",
		turnIndex: 0,
		batchId: "batch-1",
		startedAt: 2_100,
		endedAt: 2_500,
		wallMs: 400,
		workMs: 550,
		status: "error",
		tools: [tool("a", "read", 150), tool("b", "bash", 400, "error")],
	},
	{
		...base,
		sequence: 3,
		kind: "cycle",
		startedAt: 900,
		endedAt: 3_000,
		durationMs: 2_100,
		assistantDurationMs: 1_000,
		toolWallMs: 400,
		toolWorkMs: 550,
		assistantSteps: 1,
		toolCalls: 2,
		toolFailures: 1,
		toolAborts: 0,
		submissions: 1,
		userWaitMs: 100,
		retryWaitMs: 50,
		assistantUsage: {
			input: 100,
			output: 40,
			cacheRead: 500,
			cacheWrite: 10,
			totalTokens: 650,
			cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
		},
		totalUsage: {
			input: 100,
			output: 40,
			cacheRead: 500,
			cacheWrite: 10,
			totalTokens: 650,
			cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
		},
		billingMode: "metered",
		status: "failed",
	},
];

test("extracts only display-only message timing entries", () => {
	const extracted = timingRecordsFromEntries([
		{ type: "message", message: { role: "user", content: "secret" } },
		{ type: "custom", customType: "other", data: { kind: "tool" } },
		...records.map((record) => ({ type: "custom", customType: "message-timing", data: record })),
	]);
	assert.equal(extracted.length, 3);
});

test("summarizes cycles without double-counting assistant or nested batch usage", () => {
	const summary = summarizeTiming(records);
	assert.equal(summary.cycles, 1);
	assert.equal(summary.assistantSteps, 1);
	assert.equal(summary.tools, 2);
	assert.equal(summary.elapsedMs, 2_100);
	assert.equal(summary.toolWallMs, 400);
	assert.equal(summary.toolWorkMs, 550);
	assert.equal(summary.usage?.totalTokens, 650);
	assert.equal(summary.cost, 0.003);
	assert.equal(summary.ttftMedianMs, 200);
	assert.equal(summary.outputMedianTokensPerSecond, 50);
	assert.deepEqual(summary.slowestTool, { name: "bash", durationMs: 400 });
	assert.equal(summary.failures, 1);
	const rendered = formatSummary(summary).join("\n");
	assert.match(rendered, /1 cycle · 1 model step · 2 tools/);
	assert.match(rendered, /Cache read/);
});

test("formats a branch-local timeline with one batch header", () => {
	const timeline = formatTimeline(records).join("\n");
	assert.equal(timeline.match(/batch {2}2 tools/g)?.length, 1);
	assert.match(timeline, /└ read/);
	assert.match(timeline, /cycle/);
});

test("exports only bounded timing metadata as JSON", () => {
	const json = exportTimingJson(records);
	const parsed = JSON.parse(json);
	assert.equal(parsed.scope, "current-branch");
	assert.equal(parsed.records.length, 3);
	assert.doesNotMatch(json, /prompt|arguments|content|toolOutput/i);
});

test("exports batches and members as valid CSV rows", () => {
	const csv = exportTimingCsv(records);
	const lines = csv.trim().split("\n");
	assert.equal(lines.length, 6); // header + assistant + batch + 2 members + cycle
	assert.match(lines[0]!, /toolCallId/);
	assert.match(csv, /batch-1/);
	assert.doesNotMatch(csv, /secret/);
});

test("normalizes and updates persisted settings", () => {
	const defaults = normalizeSettings(undefined);
	assert.equal(defaults.display, "compact");
	assert.equal(defaults.live, true);
	const detailed = updateSetting(defaults, "display", "detailed");
	assert.equal(detailed.settings.display, "detailed");
	const noCost = updateSetting(detailed.settings, "cost", "off");
	assert.equal(noCost.settings.showCost, false);
	assert.match(formatSettings(noCost.settings).join("\n"), /cost\s+off/);
	assert.match(updateSetting(defaults, "unknown", "on").error ?? "", /Unknown setting/);
});

test("display settings hide cost and milliseconds without hiding usage", () => {
	const assistant = records[0]!;
	if (assistant.kind !== "assistant") throw new Error("fixture");
	const rendered = formatTimingRecord(assistant, false, 160, { showCost: false, showMilliseconds: false }).join("\n");
	assert.doesNotMatch(rendered, /\.000/);
	assert.doesNotMatch(rendered, /\$/);
	assert.match(rendered, /Σ650 ↑100 ↓40 R500 W10/);
});

test("safe export strips hostile extra fields from V2 and nested batch records", () => {
	const secret = "DO-NOT-EXPORT-THIS";
	const hostileTool = {
		...tool("hostile", "subagent", 20),
		prompt: secret,
		arguments: { secret },
		usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, content: secret },
	} as unknown as ToolTimingRecord;
	const hostileBatch = {
		...base,
		kind: "batch" as const,
		turnIndex: 0,
		batchId: "hostile-batch",
		startedAt: 1,
		endedAt: 21,
		wallMs: 20,
		workMs: 20,
		status: "success" as const,
		tools: [hostileTool],
		toolOutput: secret,
	} as unknown as TimingRecord;
	const exported = exportTimingJson([hostileBatch]);
	assert.doesNotMatch(exported, new RegExp(secret));
	assert.doesNotMatch(exported, /"prompt"|"arguments"|"toolOutput"|"content"/);
});

test("mixed V1 and V2 summaries retain legacy model and tool time", () => {
	const baseline = summarizeTiming(records);
	const legacy = timingRecordsFromEntries([
		{
			type: "custom",
			customType: "message-timing",
			data: { kind: "assistant", startedAt: 10, endedAt: 510, durationMs: 500 },
		},
		{
			type: "custom",
			customType: "message-timing",
			data: {
				kind: "tool",
				toolCallId: "legacy-tool",
				toolName: "read",
				startedAt: 510,
				endedAt: 1_210,
				durationMs: 700,
			},
		},
		{
			type: "custom",
			customType: "message-timing",
			data: { kind: "cycle", startedAt: 10, endedAt: 1_210, durationMs: 1_200 },
		},
	]);
	const summary = summarizeTiming([...records, ...legacy]);
	assert.equal(summary.assistantMs, baseline.assistantMs + 500);
	assert.equal(summary.toolWorkMs, baseline.toolWorkMs + 700);
	assert.equal(summary.toolWallMs, baseline.toolWallMs + 700);
});

test("mixed summaries report only the metered subtotal", () => {
	const meteredAssistant = {
		...(records[0] as Extract<TimingRecord, { kind: "assistant" }>),
		cycleId: "metered-cycle",
		usage: {
			input: 300,
			output: 40,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 340,
			cost: { input: 0.01, output: 0.01, cacheRead: 0, cacheWrite: 0, total: 0.02 },
		},
	};
	const subscriptionTool = {
		...tool("subscription", "subagent", 200),
		cycleId: "subscription-cycle",
		billingMode: "subscription" as const,
		usage: {
			input: 100,
			output: 20,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 120,
			cost: { input: 0.4, output: 0.59, cacheRead: 0, cacheWrite: 0, total: 0.99 },
		},
	};
	const summary = summarizeTiming([meteredAssistant, subscriptionTool]);

	assert.equal(summary.billing, "mixed");
	assert.equal(summary.usage?.totalTokens, 460);
	assert.equal(summary.cost, 0.02);
	const output = formatSummary(summary).join("\n");
	assert.match(output, /Billing\s+mixed/);
	assert.match(output, /Metered cost\s+\$0\.0200/);
	assert.doesNotMatch(output, /0\.9900|1\.0100/);
});

test("subscription summaries show billing mode instead of calculated cost", () => {
	const subscriptionCycle = {
		...(records.find((record) => record.kind === "cycle") as Extract<TimingRecord, { kind: "cycle" }>),
		billingMode: "subscription" as const,
	};
	const summary = summarizeTiming([subscriptionCycle]);
	assert.equal(summary.billing, "subscription");
	assert.equal(summary.cost, undefined);
	const output = formatSummary(summary).join("\n");
	assert.match(output, /Billing\s+subscription/);
	assert.doesNotMatch(output, /Cost\s+\$/);
});
