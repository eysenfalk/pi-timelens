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

const base = { schemaVersion: 3 as const, cycleId: "cycle-1", sequence: 1 };
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

const assistant: Extract<TimingRecord, { kind: "assistant" }> = {
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
};

const records: TimingRecord[] = [
	{
		...base,
		sequence: 4,
		kind: "step",
		turnIndex: 0,
		startedAt: 1_000,
		endedAt: 2_500,
		durationMs: 1_500,
		assistant,
		toolWallMs: 400,
		toolWorkMs: 550,
		tools: [tool("a", "read", 150), tool("b", "bash", 400, "error")],
		usage: assistant.usage,
		billingMode: "metered",
		status: "error",
	},
	{
		...base,
		sequence: 5,
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
		assistantUsage: assistant.usage,
		totalUsage: assistant.usage,
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
	assert.equal(extracted.length, 2);
});

test("summarizes cycles without double-counting nested Step usage", () => {
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

test("formats a branch-local timeline with one Step and its members", () => {
	const timeline = formatTimeline(records).join("\n");
	assert.equal(timeline.match(/step {3}/g)?.length, 1);
	assert.match(timeline, /└ model/);
	assert.match(timeline, /└ read/);
	assert.match(timeline, /cycle/);
});

test("exports only bounded timing metadata as JSON", () => {
	const json = exportTimingJson(records);
	const parsed = JSON.parse(json);
	assert.equal(parsed.scope, "current-branch");
	assert.equal(parsed.records.length, 2);
	assert.doesNotMatch(json, /prompt|arguments|content|toolOutput/i);
});

test("exports Steps and nested members as valid CSV rows", () => {
	const csv = exportTimingCsv(records);
	const lines = csv.trim().split("\n");
	assert.equal(lines.length, 6); // header + Step + nested assistant + 2 tools + cycle
	assert.match(lines[0]!, /stepId,parentStepId/);
	assert.match(csv, /cycle-1:turn-0/);
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
	const step = records[0]!;
	if (step.kind !== "step") throw new Error("fixture");
	const rendered = formatTimingRecord(step, false, 160, { showCost: false, showMilliseconds: false }).join("\n");
	assert.doesNotMatch(rendered, /\.000/);
	assert.doesNotMatch(rendered, /\$/);
	assert.match(rendered, /650 tokens · 500 cached · 10 cache write/);
});

test("safe export strips hostile extra fields from V3 and nested Step records", () => {
	const secret = "DO-NOT-EXPORT-THIS";
	const hostileTool = {
		...tool("hostile", "subagent", 20),
		prompt: secret,
		arguments: { secret },
		usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, content: secret },
	} as unknown as ToolTimingRecord;
	const hostileStep = {
		...base,
		kind: "step" as const,
		turnIndex: 0,
		startedAt: 1,
		endedAt: 21,
		durationMs: 20,
		toolWallMs: 20,
		toolWorkMs: 20,
		status: "success" as const,
		billingMode: "unknown" as const,
		tools: [hostileTool],
		toolOutput: secret,
	} as unknown as TimingRecord;
	const exported = exportTimingJson([hostileStep]);
	assert.doesNotMatch(exported, new RegExp(secret));
	assert.doesNotMatch(exported, /"prompt"|"arguments"|"toolOutput"|"content"/);
});

test("mixed V1 and V3 summaries retain legacy model and tool time", () => {
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

test("retains V1 child usage when its cycle has no aggregate", () => {
	const legacy = timingRecordsFromEntries([
		{
			type: "custom",
			customType: "message-timing",
			data: {
				kind: "assistant",
				startedAt: 10,
				endedAt: 20,
				durationMs: 10,
				usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12 },
			},
		},
		{
			type: "custom",
			customType: "message-timing",
			data: {
				kind: "tool",
				toolCallId: "legacy-usage-tool",
				toolName: "read",
				startedAt: 20,
				endedAt: 30,
				durationMs: 10,
				usage: { input: 5, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 6 },
			},
		},
		{
			type: "custom",
			customType: "message-timing",
			data: { kind: "cycle", startedAt: 10, endedAt: 30, durationMs: 20 },
		},
		{
			type: "custom",
			customType: "message-timing",
			data: {
				kind: "assistant",
				startedAt: 40,
				endedAt: 50,
				durationMs: 10,
				usage: { input: 25, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 30 },
			},
		},
		{
			type: "custom",
			customType: "message-timing",
			data: {
				kind: "cycle",
				startedAt: 40,
				endedAt: 50,
				durationMs: 10,
				totalUsage: { input: 25, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 30 },
			},
		},
	]);
	const summary = summarizeTiming(legacy);

	assert.equal(summary.usage?.totalTokens, 48);
	assert.equal(legacy[0]?.cycleId, "legacy-v1-0");
	assert.equal(legacy[2]?.cycleId, "legacy-v1-0");
	assert.equal(legacy[3]?.cycleId, "legacy-v1-1");
	assert.equal(legacy[4]?.cycleId, "legacy-v1-1");
});

test("omits subscription costs from direct and nested exports", () => {
	const subscriptionUsage = {
		input: 100,
		output: 20,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 120,
		cost: { input: 0.4, output: 0.59, cacheRead: 0, cacheWrite: 0, total: 0.99 },
	};
	const subscriptionAssistant = {
		...assistant,
		billingMode: "subscription" as const,
		usage: subscriptionUsage,
	};
	const subscriptionTool = {
		...tool("subscription-export", "subagent", 200),
		billingMode: "subscription" as const,
		usage: subscriptionUsage,
	};
	const subscriptionStep: Extract<TimingRecord, { kind: "step" }> = {
		...(records[0] as Extract<TimingRecord, { kind: "step" }>),
		assistant: subscriptionAssistant,
		tools: [subscriptionTool],
		usage: subscriptionUsage,
		billingMode: "subscription",
	};
	const exported = exportTimingJson([subscriptionAssistant, subscriptionTool, subscriptionStep]);
	const csv = exportTimingCsv([subscriptionAssistant, subscriptionTool, subscriptionStep]);

	assert.doesNotMatch(exported, /"cost"/);
	assert.doesNotMatch(csv, /0\.99/);
});

test("mixed summaries report only the metered subtotal", () => {
	const meteredAssistant = {
		...assistant,
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
