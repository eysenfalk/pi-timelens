import assert from "node:assert/strict";
import test from "node:test";
import {
	type ClockReading,
	coerceTimingRecord,
	formatDuration,
	formatLiveSnapshot,
	formatTimingRecord,
	formatUsageCompact,
	isMeaningfulAssistantEvent,
	normalizeUsage,
	TimingTracker,
} from "../extensions/pi-timelens/core.ts";

const at = (wallMs: number, monoMs = wallMs): ClockReading => ({ wallMs, monoMs });
const usage = (input: number, output: number, cacheRead = 0, cacheWrite = 0, cost?: number) => ({
	input,
	output,
	cacheRead,
	cacheWrite,
	totalTokens: input + output + cacheRead + cacheWrite,
	cost: cost === undefined ? undefined : { input: 0, output: cost, cacheRead: 0, cacheWrite: 0, total: cost },
});

function beginTurn(tracker: TimingTracker, turnIndex = 0): void {
	tracker.startSubmission(at(1_000, 10));
	tracker.startAgent(at(1_001, 11));
	tracker.startTurn(turnIndex, at(1_010, 20));
}

test("uses monotonic elapsed time when the wall clock moves backward", () => {
	const tracker = new TimingTracker();
	tracker.startSubmission(at(10_000, 100));
	tracker.startTurn(0, at(10_010, 110));
	tracker.markFirstOutput(0, at(9_500, 160));
	const record = tracker.finishAssistant(
		{ content: [{ type: "text", text: "done" }], usage: usage(10, 5) },
		at(9_000, 210),
	);
	const cycle = tracker.settle(at(8_000, 260))!;

	assert.equal(record.durationMs, 100);
	assert.equal(record.ttftMs, 50);
	assert.equal(record.streamingMs, 50);
	assert.equal(record.startedAt, 10_010);
	assert.equal(record.endedAt, 10_010);
	assert.equal(cycle.durationMs, 160);
});

test("records TTFT, streaming duration, full usage, speed, and metered cost", () => {
	const tracker = new TimingTracker();
	beginTurn(tracker);
	tracker.markFirstOutput(0, at(1_210, 220));
	const record = tracker.finishAssistant(
		{
			provider: "openai",
			model: "gpt-test",
			stopReason: "stop",
			content: [{ type: "text", text: "hello" }],
			usage: usage(1_500, 200, 8_000, 100, 0.0123),
		},
		at(2_210, 1_220),
	);

	assert.equal(record.ttftMs, 200);
	assert.equal(record.streamingMs, 1_000);
	assert.equal(record.outputTokensPerSecond, 200);
	assert.deepEqual(record.usage, normalizeUsage(usage(1_500, 200, 8_000, 100, 0.0123)));
	assert.equal(record.billingMode, "metered");
	assert.match(formatTimingRecord(record, false)[0]!, /TTFT 200ms · 200\.0 tok\/s/);
	assert.match(formatTimingRecord(record, false).join("\n"), /Σ9\.8k ↑1\.5k ↓200 R8k W100 · \$0\.012/);
});

test("shows subscription mode without a fabricated zero cost", () => {
	const tracker = new TimingTracker();
	beginTurn(tracker);
	const record = tracker.finishAssistant(
		{
			provider: "openai-codex",
			content: [{ type: "text", text: "done" }],
			usage: usage(100, 20, 0, 0, 0.0123),
		},
		at(1_500, 510),
	);
	const rendered = formatTimingRecord(record, false).join("\n");
	assert.equal(record.billingMode, "subscription");
	assert.match(rendered, / · sub$/);
	assert.doesNotMatch(rendered, /\$0/);
	assert.doesNotMatch(formatTimingRecord(record, true).join("\n"), /Cost:/);
});

test("preserves known subscription billing when the persisted tool message omits provider", () => {
	const tracker = new TimingTracker();
	beginTurn(tracker);
	tracker.finishAssistant({ stopReason: "toolUse", content: [] }, at(1_050, 60));
	const providerResult = { provider: "openai-codex", usage: usage(100, 20, 0, 0, 0.99) };
	tracker.startTool("sub", "subagent", at(1_100, 100));
	tracker.finishTool("sub", "subagent", providerResult, false, at(1_300, 300));
	tracker.consumeToolResult("sub", { usage: providerResult.usage }, false);
	const tool = tracker.finishTurn(0)!;
	const cycle = tracker.settle(at(1_400, 400))!;

	assert.equal(tool.kind, "tool");
	assert.equal(tool.billingMode, "subscription");
	assert.match(formatTimingRecord(tool, false).join("\n"), / · sub$/);
	assert.equal(cycle.billingMode, "subscription");
	assert.equal(cycle.totalUsage?.cost, undefined);
});

test("consolidates parallel tools in source order with wall and work durations", () => {
	const tracker = new TimingTracker();
	beginTurn(tracker);
	tracker.finishAssistant({ stopReason: "toolUse", content: [] }, at(1_050, 60));
	tracker.startTool("a", "read", at(1_100, 100));
	tracker.startTool("b", "bash", at(1_101, 101));
	tracker.startTool("c", "read", at(1_102, 102));

	// Completion order deliberately differs from source/start order.
	tracker.finishTool("c", "read", {}, false, at(1_216, 216));
	tracker.finishTool("a", "read", {}, false, at(1_281, 281));
	tracker.finishTool("b", "bash", {}, false, at(1_494, 494));
	tracker.consumeToolResult("a", undefined, false);
	tracker.consumeToolResult("b", undefined, false);
	tracker.consumeToolResult("c", undefined, false);
	const batch = tracker.finishTurn(0)!;

	assert.equal(batch.kind, "batch");
	if (batch.kind !== "batch") return;
	assert.deepEqual(
		batch.tools.map((tool) => tool.toolCallId),
		["a", "b", "c"],
	);
	assert.equal(batch.wallMs, 394);
	assert.equal(batch.workMs, 181 + 393 + 114);
	const rendered = formatTimingRecord(batch, false).join("\n");
	assert.match(rendered, /◆ Batch · 3 tools · wall 394ms · work 688ms/);
	assert.doesNotMatch(rendered, /tok —/);
	assert.deepEqual(rendered.split("\n").slice(1), ["  1. read · 181ms", "  2. bash · 393ms", "  3. read · 114ms"]);
});

test("aggregates provider-reported model usage once for the whole batch", () => {
	const tracker = new TimingTracker();
	beginTurn(tracker);
	tracker.finishAssistant({ stopReason: "toolUse", content: [] }, at(1_050, 60));
	tracker.startTool("a", "subagent", at(1_100, 100));
	tracker.startTool("b", "research", at(1_100, 100));
	const directResult = { provider: "openai", usage: usage(100, 20, 400, 0, 0.01) };
	const nestedResult = {
		details: { results: [{ model: "openai/gpt-5", usage: usage(300, 40, 500, 10, 0.02) }] },
	};
	tracker.finishTool("a", "subagent", directResult, false, at(1_300, 300));
	tracker.finishTool("b", "research", nestedResult, false, at(1_400, 400));
	tracker.consumeToolResult("a", directResult, false);
	tracker.consumeToolResult("b", nestedResult, false);
	const batch = tracker.finishTurn(0)!;
	const compact = formatTimingRecord(batch, false, 160).join("\n");
	const expanded = formatTimingRecord(batch, true, 160).join("\n");
	const narrow = formatTimingRecord(batch, false, 60);

	assert.match(compact.split("\n")[0]!, /Σ1\.4k ↑400 ↓60 R900 W10 · \$0\.030$/);
	assert.doesNotMatch(compact.split("\n").slice(1).join("\n"), /Σ|\$/);
	assert.equal(narrow.join("\n").match(/Σ/g)?.length, 1);
	assert.match(narrow.join("\n"), /\$0\.030/);
	assert.ok(narrow.every((line) => line.length <= 60));
	assert.match(expanded, /a .* Σ520 ↑100 ↓20 R400 W0 · \$0\.010/);
	assert.match(expanded, /b .* Σ850 ↑300 ↓40 R500 W10 · \$0\.020/);
});

test("labels subscription-backed batch usage without fabricating a price", () => {
	const tracker = new TimingTracker();
	beginTurn(tracker);
	tracker.finishAssistant({ stopReason: "toolUse", content: [] }, at(1_050, 60));
	for (const [id, start] of [
		["a", 100],
		["b", 110],
	] as const) {
		tracker.startTool(id, "subagent", at(1_000 + start, start));
		const result = {
			details: { results: [{ model: "openai-codex/gpt-5.4", usage: usage(100, 20, 0, 0, 0.01) }] },
		};
		tracker.finishTool(id, "subagent", result, false, at(1_300, 300));
		tracker.consumeToolResult(id, result, false);
	}
	const rendered = formatTimingRecord(tracker.finishTurn(0)!, false).join("\n");

	assert.match(rendered.split("\n")[0]!, /Σ240 ↑200 ↓40 R0 W0 · sub$/);
	assert.doesNotMatch(rendered, /\$/);
});

test("keeps mixed batch and cycle billing truthful", () => {
	const tracker = new TimingTracker();
	beginTurn(tracker);
	tracker.finishAssistant({ stopReason: "toolUse", content: [] }, at(1_050, 60));
	const metered = { provider: "openai", usage: usage(300, 40, 500, 10, 0.02) };
	const subscription = { provider: "openai-codex", usage: usage(100, 20, 0, 0, 0.99) };
	tracker.startTool("metered", "research", at(1_100, 100));
	tracker.startTool("subscription", "subagent", at(1_110, 110));
	tracker.finishTool("metered", "research", metered, false, at(1_300, 300));
	tracker.finishTool("subscription", "subagent", subscription, false, at(1_400, 400));
	tracker.consumeToolResult("metered", metered, false);
	tracker.consumeToolResult("subscription", subscription, false);
	const batch = tracker.finishTurn(0)!;
	const cycle = tracker.settle(at(1_500, 500))!;
	const compact = formatTimingRecord(batch, false, 160).join("\n");
	const expanded = formatTimingRecord(batch, true, 160).join("\n");

	assert.match(compact.split("\n")[0]!, /Σ970 ↑400 ↓60 R500 W10 · \$0\.020 \+ sub$/);
	assert.match(formatTimingRecord(batch, false, 160, { showCost: false })[0]!, / · mixed$/);
	assert.equal(cycle.billingMode, "mixed");
	assert.equal(cycle.totalUsage?.cost?.total, 0.02);
	assert.match(formatTimingRecord(cycle, false, 160).join("\n"), /\$0\.020 \+ sub$/);
	assert.match(expanded, /metered .* \$0\.020/);
	assert.match(expanded, /subscription .* sub/);
	assert.doesNotMatch(expanded, /\$0\.990/);
});

test("prefers bounded direct usage over nested or deeper usage", () => {
	const tracker = new TimingTracker();
	beginTurn(tracker);
	tracker.finishAssistant({ stopReason: "toolUse", content: [] }, at(1_050, 60));
	const result = {
		provider: "openai",
		usage: usage(10, 2, 0, 0, 0.01),
		details: {
			usage: usage(100, 20, 0, 0, 0.1),
			results: [{ usage: usage(1_000, 200, 0, 0, 1) }],
			arbitrary: { deeper: { usage: usage(10_000, 2_000, 0, 0, 10) } },
		},
	};
	tracker.startTool("model", "research", at(1_100, 100));
	tracker.finishTool("model", "research", result, false, at(1_300, 300));
	tracker.consumeToolResult("model", result, false);
	const record = tracker.finishTurn(0)!;

	assert.equal(record.kind, "tool");
	assert.equal(record.usage?.totalTokens, 12);
	assert.equal(record.usage?.cost?.total, 0.01);
});

test("derives mixed billing from every bounded nested result regardless of order", () => {
	for (const subscriptionFirst of [true, false]) {
		const tracker = new TimingTracker();
		beginTurn(tracker);
		tracker.finishAssistant({ stopReason: "toolUse", content: [] }, at(1_050, 60));
		const metered = { model: "openai/gpt-test", usage: usage(300, 40, 500, 10, 0.02) };
		const subscription = { model: "openai-codex/gpt-test", usage: usage(100, 20, 0, 0, 0.99) };
		const result = {
			usage: usage(420, 60, 500, 10, 1.01),
			details: { results: subscriptionFirst ? [subscription, metered] : [metered, subscription] },
		};
		tracker.startTool("mixed", "subagent", at(1_100, 100));
		tracker.finishTool("mixed", "subagent", result, false, at(1_300, 300));
		tracker.consumeToolResult("mixed", { usage: result.usage }, false);
		const record = tracker.finishTurn(0)!;

		assert.equal(record.kind, "tool");
		assert.equal(record.billingMode, "mixed");
		assert.equal(record.usage?.totalTokens, 990);
		assert.equal(record.usage?.cost?.total, 0.02);
		assert.match(formatTimingRecord(record, false).join("\n"), /\$0\.020 \+ sub$/);
		assert.doesNotMatch(formatTimingRecord(record, false).join("\n"), /1\.010/);
	}
});

test("keeps failures and model-backed usage attributable in expanded batches", () => {
	const tracker = new TimingTracker();
	beginTurn(tracker);
	tracker.finishAssistant({ stopReason: "toolUse", content: [] }, at(1_050, 60));
	tracker.startTool("read", "read", at(1_100, 100));
	tracker.startTool("child", "subagent", at(1_100, 100));
	tracker.finishTool("read", "read", { message: "failed" }, true, at(1_200, 200));
	tracker.finishTool(
		"child",
		"subagent",
		{ provider: "openai", usage: usage(7_700, 512, 0, 0, 0.027) },
		false,
		at(4_500, 3_500),
	);
	tracker.consumeToolResult("read", undefined, true);
	tracker.consumeToolResult("child", { usage: usage(7_700, 512, 0, 0, 0.027) }, false);
	const batch = tracker.finishTurn(0)!;
	const compact = formatTimingRecord(batch, false).join("\n");
	const expanded = formatTimingRecord(batch, true).join("\n");

	assert.match(compact.split("\n")[0]!, /Σ8\.2k ↑7\.7k ↓512 R0 W0 · \$0\.027$/);
	assert.match(compact, /read · 100ms · failed/);
	assert.match(compact, /subagent · 3\.40s/);
	assert.doesNotMatch(compact.split("\n").slice(1).join("\n"), /tok —|Σ|\$/);
	assert.match(expanded, /child .* Σ8\.2k ↑7\.7k ↓512 R0 W0 · \$0\.027/);
});

test("a recovered tool failure keeps the cycle Total while retaining its failure count", () => {
	const tracker = new TimingTracker();
	beginTurn(tracker);
	tracker.finishAssistant({ stopReason: "toolUse", content: [] }, at(1_050, 60));
	tracker.startTool("failed", "aft_delete", at(1_100, 100));
	tracker.finishTool("failed", "aft_delete", { message: "file not found" }, true, at(1_200, 200));
	tracker.consumeToolResult("failed", undefined, true);
	tracker.finishTurn(0);

	tracker.startTurn(1, at(1_300, 300));
	tracker.finishAssistant({ stopReason: "stop", content: [{ type: "text", text: "done" }] }, at(1_400, 400));
	const cycle = tracker.settle(at(1_410, 410))!;

	assert.equal(cycle.toolFailures, 1);
	assert.equal(cycle.status, "success");
	assert.match(formatTimingRecord(cycle, false)[0]!, /^◆ Total/);
});

test("a successful assistant retry restores Total and retains retry wait", () => {
	const tracker = new TimingTracker();
	beginTurn(tracker);
	tracker.finishAssistant({ stopReason: "error", content: [] }, at(1_500, 510));
	tracker.startAgent(at(2_500, 1_510));
	tracker.startTurn(1, at(2_510, 1_520));
	tracker.finishAssistant({ stopReason: "stop", content: [{ type: "text", text: "recovered" }] }, at(3_000, 2_010));
	const cycle = tracker.settle(at(3_010, 2_020))!;

	assert.equal(cycle.retryWaitMs, 1_000);
	assert.equal(cycle.status, "success");
	assert.match(formatTimingRecord(cycle, false)[0]!, /^◆ Total/);
});

test("aborted cycles remain aborted despite later assistant events", () => {
	for (const abortSource of ["assistant", "tool"] as const) {
		for (const laterStopReason of ["stop", "error"] as const) {
			const tracker = new TimingTracker();
			beginTurn(tracker);
			if (abortSource === "assistant") {
				tracker.finishAssistant({ stopReason: "aborted", content: [] }, at(1_050, 60));
			} else {
				tracker.finishAssistant({ stopReason: "toolUse", content: [] }, at(1_050, 60));
				tracker.startTool("aborted", "bash", at(1_100, 100));
				tracker.finishTool("aborted", "bash", { aborted: true }, true, at(1_200, 200));
				tracker.consumeToolResult("aborted", undefined, true);
				tracker.finishTurn(0);
			}
			tracker.startTurn(1, at(1_300, 300));
			tracker.finishAssistant(
				{ stopReason: laterStopReason, content: [{ type: "text", text: "late" }] },
				at(1_400, 400),
			);
			const cycle = tracker.settle(at(1_410, 410))!;
			assert.equal(cycle.status, "aborted", `${abortSource} followed by ${laterStopReason}`);
			assert.match(formatTimingRecord(cycle, false)[0]!, /^◆ Aborted/);
		}
	}
});

test("an unrecovered terminal tool failure still marks the cycle Failed", () => {
	const tracker = new TimingTracker();
	beginTurn(tracker);
	tracker.finishAssistant({ stopReason: "toolUse", content: [] }, at(1_050, 60));
	tracker.startTool("failed", "bash", at(1_100, 100));
	tracker.finishTool("failed", "bash", { message: "failed" }, true, at(1_200, 200));
	tracker.consumeToolResult("failed", undefined, true);
	tracker.finishTurn(0);
	const cycle = tracker.settle(at(1_210, 210))!;

	assert.equal(cycle.toolFailures, 1);
	assert.equal(cycle.status, "failed");
	assert.match(formatTimingRecord(cycle, false)[0]!, /^◆ Failed/);
});

test("keeps a single tool as one compact tool record", () => {
	const tracker = new TimingTracker();
	beginTurn(tracker);
	tracker.finishAssistant({ stopReason: "toolUse", content: [] }, at(1_050, 60));
	tracker.startTool("only", "bash", at(1_100, 100));
	tracker.finishTool("only", "bash", {}, false, at(1_600, 600));
	tracker.consumeToolResult("only", undefined, false);
	const record = tracker.finishTurn(0)!;
	assert.equal(record.kind, "tool");
	assert.match(formatTimingRecord(record, false)[0]!, /└ bash .* 500ms$/);
	assert.doesNotMatch(formatTimingRecord(record, true).join("\n"), /tok —|Tokens: —/);
});

test("computes union tool wall time separately from cumulative work", () => {
	const tracker = new TimingTracker();
	beginTurn(tracker);
	tracker.finishAssistant({ stopReason: "toolUse", content: [] }, at(1_050, 60));
	tracker.startTool("a", "read", at(1_100, 100));
	tracker.startTool("b", "read", at(1_150, 150));
	tracker.finishTool("a", "read", {}, false, at(1_300, 300));
	tracker.finishTool("b", "read", {}, false, at(1_400, 400));
	tracker.consumeToolResult("a", undefined, false);
	tracker.consumeToolResult("b", undefined, false);
	tracker.finishTurn(0);
	const cycle = tracker.settle(at(1_500, 500))!;
	assert.equal(cycle.toolWallMs, 300);
	assert.equal(cycle.toolWorkMs, 450);
	assert.equal(cycle.toolCalls, 2);
});

test("separates user and retry wait from elapsed time", () => {
	const tracker = new TimingTracker();
	beginTurn(tracker);
	tracker.finishAssistant({ stopReason: "error", content: [] }, at(1_500, 510));
	tracker.startAgent(at(2_500, 1_510));
	tracker.startUserPrompt(at(3_000, 2_010));
	tracker.endUserPrompt(at(6_000, 5_010));
	const cycle = tracker.settle(at(7_000, 6_010))!;
	assert.equal(cycle.retryWaitMs, 1_000);
	assert.equal(cycle.userWaitMs, 3_000);
});

test("recognizes canonical aborted tool contracts", () => {
	for (const [index, result] of [
		{ cancelled: true },
		{ details: { aborted: true } },
		{ name: "AbortError" },
		{ code: "ABORT_ERR" },
		{ message: "The operation was aborted" },
	].entries()) {
		const tracker = new TimingTracker();
		tracker.startSubmission(at(100, 100));
		tracker.startTurn(0, at(101, 101));
		tracker.startTool(`abort-${index}`, "bash", at(110, 110));
		const record = tracker.finishTool(`abort-${index}`, "bash", result, true, at(120, 120));
		assert.equal(record.status, "aborted");
	}
});

test("renders responsive token breakdowns without exceeding width", () => {
	const tracker = new TimingTracker();
	beginTurn(tracker);
	tracker.markFirstOutput(0, at(1_110, 120));
	const record = tracker.finishAssistant(
		{
			provider: "openai",
			model: "gpt-test",
			content: [{ type: "text", text: "done" }],
			usage: usage(8_921, 284, 8_104, 31, 0.0031),
		},
		at(2_110, 1_120),
	);
	for (const width of [60, 88, 120, 160]) {
		const lines = formatTimingRecord(record, false, width);
		assert.ok(lines.length <= 3);
		assert.ok(lines.every((line) => line.length <= width));
		assert.match(lines.join("\n"), /Σ17\.3k ↑8\.9k ↓284 R8\.1k W31/);
	}
	const narrow = formatTimingRecord(record, false, 56);
	assert.match(narrow.join("\n"), /284\.0 tok\/s/);
	assert.ok(
		narrow.every((line) => !/\d+\.\d$/u.test(line)),
		"responsive wrapping must not cut a unit label",
	);
	const cycle = tracker.settle(at(2_120, 1_130))!;
	const cycleText = formatTimingRecord(cycle, false, 60).join("\n");
	assert.match(cycleText, /1 step/);
	assert.match(cycleText, /0 tools/);
	assert.equal(formatDuration(42), "42ms");
	assert.equal(formatUsageCompact(undefined), "tok —");
});

test("coerces legacy V1 tool records without adding an unavailable-usage placeholder", () => {
	const legacy = coerceTimingRecord({
		kind: "tool",
		toolCallId: "legacy-tool",
		toolName: "read",
		startedAt: 100,
		endedAt: 150,
		durationMs: 50,
		status: "success",
	});
	assert.equal(legacy?.schemaVersion, 2);
	assert.equal(legacy?.cycleId, "legacy-v1");
	assert.doesNotMatch(formatTimingRecord(legacy!, false).join("\n"), /tok —/);
});

test("recognizes only real assistant output events", () => {
	assert.equal(isMeaningfulAssistantEvent({ type: "start" }), false);
	assert.equal(isMeaningfulAssistantEvent({ type: "text_start" }), false);
	assert.equal(isMeaningfulAssistantEvent({ type: "text_delta", delta: "" }), false);
	assert.equal(isMeaningfulAssistantEvent({ type: "text_delta", delta: "a" }), true);
	assert.equal(isMeaningfulAssistantEvent({ type: "thinking_delta", delta: "x" }), true);
	assert.equal(isMeaningfulAssistantEvent({ type: "toolcall_delta", delta: "{" }), true);
});

test("formats live assistant, parallel tool, and waiting states", () => {
	const tracker = new TimingTracker();
	tracker.startSubmission(at(100, 100));
	tracker.startTurn(0, at(110, 110));
	tracker.updateStreamingUsage(usage(1_000, 284));
	assert.match(formatLiveSnapshot(tracker.live(at(210, 210))!), /assistant · ↓284/);
	tracker.startTool("one", "read", at(220, 220));
	tracker.startTool("two", "bash", at(230, 230));
	assert.match(formatLiveSnapshot(tracker.live(at(330, 330))!), /2 tools/);
	tracker.startUserPrompt(at(340, 340));
	assert.match(formatLiveSnapshot(tracker.live(at(440, 440))!), /waiting for input/);
});

test("does not invent absent provider usage categories or output speed", () => {
	const tracker = new TimingTracker();
	beginTurn(tracker);
	tracker.markFirstOutput(0, at(1_100, 110));
	const assistant = tracker.finishAssistant(
		{
			provider: "partial-provider",
			content: [{ type: "text", text: "done" }],
			usage: { input: 100 },
		},
		at(2_100, 1_110),
	);
	assert.equal(assistant.outputTokensPerSecond, undefined);
	assert.equal(formatUsageCompact(assistant.usage), "Σ— ↑100 ↓— R— W—");

	tracker.startTool("partial", "model-tool", at(2_200, 1_210));
	const tool = tracker.finishTool("partial", "model-tool", { usage: { input: 25 } }, false, at(2_300, 1_310));
	assert.ok(tool);
	assert.equal(formatUsageCompact(tool?.usage), "Σ— ↑25 ↓— R— W—");
});
