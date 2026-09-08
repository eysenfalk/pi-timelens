import assert from "node:assert/strict";
import test from "node:test";
import type { TimingRecord } from "../extensions/pi-timelens/core.ts";
import { ENTRY_TYPE, registerMessageTiming, STATE_EVENT } from "../extensions/pi-timelens/runtime.ts";
import { DEFAULT_TIMING_SETTINGS, type TimingSettings } from "../extensions/pi-timelens/settings.ts";

type Handler = (event: any, ctx: any) => any;

function harness(getSettings?: () => TimingSettings) {
	const handlers = new Map<string, Handler[]>();
	const eventHandlers = new Map<string, Array<(data: unknown) => void>>();
	const renderers = new Map<string, (entry: any, options: any, theme: any) => any>();
	const appended: TimingRecord[] = [];
	const statuses: Array<{ key: string; content?: string }> = [];
	const stateEvents: unknown[] = [];
	const deferred = new Map<number, () => void>();
	const intervals = new Map<number, () => void>();
	let nextHandle = 1;
	let wall = 0;
	let mono = 0;
	let idle = true;
	const theme = { fg: (_color: string, value: string) => value };
	const ctx = {
		mode: "tui",
		hasUI: true,
		isIdle: () => idle,
		ui: {
			theme,
			setStatus(key: string, content?: string) {
				statuses.push({ key, content });
			},
		},
	};
	const events = {
		on(name: string, handler: (data: unknown) => void) {
			eventHandlers.set(name, [...(eventHandlers.get(name) ?? []), handler]);
		},
		emit(name: string, data: unknown) {
			if (name === STATE_EVENT) stateEvents.push(data);
			for (const handler of eventHandlers.get(name) ?? []) handler(data);
		},
	};
	const pi = {
		events,
		on(name: string, handler: Handler) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		registerEntryRenderer(name: string, renderer: (entry: any, options: any, theme: any) => any) {
			renderers.set(name, renderer);
		},
		appendEntry(_name: string, record: TimingRecord) {
			appended.push(record);
		},
	};
	registerMessageTiming(
		pi as never,
		{
			wallNow: () => wall,
			monoNow: () => mono,
			defer(callback) {
				const handle = nextHandle++;
				deferred.set(handle, callback);
				return handle;
			},
			cancelDeferred(handle) {
				deferred.delete(handle as number);
			},
			every(callback) {
				const handle = nextHandle++;
				intervals.set(handle, callback);
				return handle;
			},
			cancelEvery(handle) {
				intervals.delete(handle as number);
			},
		},
		getSettings ? { getSettings } : {},
	);

	return {
		appended,
		statuses,
		stateEvents,
		setTime(wallMs: number, monoMs = wallMs) {
			wall = wallMs;
			mono = monoMs;
		},
		setIdle(value: boolean) {
			idle = value;
		},
		async emit(name: string, event: any = {}) {
			for (const handler of handlers.get(name) ?? []) await handler({ type: name, ...event }, ctx);
		},
		flushDeferred() {
			const pending = [...deferred.entries()];
			deferred.clear();
			for (const [, callback] of pending) callback();
		},
		tickLive() {
			for (const callback of intervals.values()) callback();
		},
		render(record: unknown, expanded = false, width = 160) {
			const renderer = renderers.get(ENTRY_TYPE);
			assert.ok(renderer);
			return renderer({ data: record }, { expanded }, theme).render(width).join("\n");
		},
		deferredCount: () => deferred.size,
		intervalCount: () => intervals.size,
	};
}

const usage = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({
	input,
	output,
	cacheRead,
	cacheWrite,
	totalTokens: input + output + cacheRead + cacheWrite,
});

async function startTurn(h: ReturnType<typeof harness>, turnIndex = 0): Promise<void> {
	h.setTime(1_000, 10);
	await h.emit("input", { text: "Inspect", source: "interactive" });
	h.setIdle(false);
	h.setTime(1_005, 15);
	await h.emit("message_end", { message: { role: "user", timestamp: 1_004 } });
	h.flushDeferred();
	h.setTime(1_010, 20);
	await h.emit("agent_start");
	await h.emit("turn_start", { turnIndex, timestamp: 1_020 });
}

test("emits one consolidated entry after a parallel batch", async () => {
	const h = harness();
	await h.emit("session_start", { reason: "startup" });
	await startTurn(h);

	h.setTime(1_100, 120);
	await h.emit("message_update", {
		message: { role: "assistant", usage: usage(800, 20) },
		assistantMessageEvent: { type: "text_delta", delta: "I will inspect" },
	});
	h.setTime(1_300, 320);
	await h.emit("message_end", {
		message: {
			role: "assistant",
			provider: "openai",
			model: "gpt-test",
			stopReason: "toolUse",
			usage: usage(900, 100),
			content: [],
		},
	});
	h.flushDeferred();

	h.setTime(1_310, 330);
	await h.emit("tool_execution_start", { toolCallId: "a", toolName: "read" });
	h.setTime(1_311, 331);
	await h.emit("tool_execution_start", { toolCallId: "b", toolName: "bash" });
	assert.deepEqual((h.stateEvents.at(-1) as any).activeTools, ["read", "bash"]);
	// Finish in reverse order.
	h.setTime(1_500, 520);
	await h.emit("tool_execution_end", { toolCallId: "b", toolName: "bash", result: {}, isError: false });
	h.setTime(1_600, 620);
	await h.emit("tool_execution_end", { toolCallId: "a", toolName: "read", result: {}, isError: false });
	// Persisted result events arrive in source order.
	await h.emit("message_end", { message: { role: "toolResult", toolCallId: "a", usage: undefined, isError: false } });
	await h.emit("message_end", { message: { role: "toolResult", toolCallId: "b", usage: undefined, isError: false } });
	assert.equal(h.deferredCount(), 0);
	await h.emit("turn_end", { turnIndex: 0, toolResults: [] });
	assert.equal(h.deferredCount(), 1);
	h.flushDeferred();

	assert.deepEqual(
		h.appended.map((record) => record.kind),
		["user", "assistant", "batch"],
	);
	const batch = h.appended.at(-1)!;
	assert.equal(batch.kind, "batch");
	if (batch.kind !== "batch") return;
	assert.deepEqual(
		batch.tools.map((tool) => tool.toolCallId),
		["a", "b"],
	);
	assert.equal(h.render(batch).match(/◆ Batch/g)?.length, 1);
	assert.doesNotMatch(h.render(batch), /tok —/);
});

test("aggregates nested model-backed usage through the runtime adapter", async () => {
	const h = harness();
	await h.emit("session_start", { reason: "startup" });
	await startTurn(h);
	await h.emit("message_end", { message: { role: "assistant", stopReason: "toolUse", content: [] } });
	const nestedResult = {
		details: {
			results: [
				{
					model: "openai/gpt-test",
					usage: {
						...usage(300, 40, 500, 10),
						cost: { input: 0.01, output: 0.01, cacheRead: 0, cacheWrite: 0, total: 0.02 },
					},
				},
			],
		},
	};
	await h.emit("tool_execution_start", { toolCallId: "a", toolName: "read" });
	await h.emit("tool_execution_start", { toolCallId: "b", toolName: "subagent" });
	h.setTime(1_300, 300);
	await h.emit("tool_execution_end", { toolCallId: "a", toolName: "read", result: {}, isError: false });
	h.setTime(1_400, 400);
	await h.emit("tool_execution_end", { toolCallId: "b", toolName: "subagent", result: nestedResult, isError: false });
	await h.emit("message_end", { message: { role: "toolResult", toolCallId: "a", isError: false } });
	await h.emit("message_end", {
		message: { role: "toolResult", toolCallId: "b", isError: false, ...nestedResult },
	});
	await h.emit("turn_end", { turnIndex: 0 });
	h.flushDeferred();
	const batch = h.appended.at(-1)!;
	assert.equal(batch.kind, "batch");
	assert.match(h.render(batch).split("\n")[0]!, /Σ850 ↑300 ↓40 R500 W10 · \$0\.020$/);
	assert.doesNotMatch(h.render(batch).split("\n").slice(1).join("\n"), /Σ|\$|tok —/);
	assert.match(h.render(batch, true), /b .* Σ850 ↑300 ↓40 R500 W10 · \$0\.020/);
});

test("emits one compact record for a single tool", async () => {
	const h = harness();
	await h.emit("session_start");
	await startTurn(h);
	h.setTime(1_100, 120);
	await h.emit("message_end", { message: { role: "assistant", stopReason: "toolUse", content: [] } });
	h.setTime(1_110, 130);
	await h.emit("tool_execution_start", { toolCallId: "one", toolName: "read" });
	h.setTime(1_210, 230);
	await h.emit("tool_execution_end", { toolCallId: "one", toolName: "read", result: {}, isError: false });
	await h.emit("message_end", { message: { role: "toolResult", toolCallId: "one", isError: false } });
	await h.emit("turn_end", { turnIndex: 0 });
	h.flushDeferred();
	assert.equal(h.appended.filter((record) => record.kind === "tool").length, 1);
	assert.equal(h.appended.filter((record) => record.kind === "batch").length, 0);
});

test("records TTFT from the first meaningful delta and uses monotonic duration", async () => {
	const h = harness();
	await h.emit("session_start");
	await startTurn(h);
	h.setTime(900, 70);
	await h.emit("message_update", {
		message: { role: "assistant", usage: usage(100, 1) },
		assistantMessageEvent: { type: "start" },
	});
	h.setTime(800, 120);
	await h.emit("message_update", {
		message: { role: "assistant", usage: usage(100, 2) },
		assistantMessageEvent: { type: "text_delta", delta: "x" },
	});
	h.setTime(700, 220);
	await h.emit("message_end", {
		message: {
			role: "assistant",
			provider: "openai",
			stopReason: "stop",
			usage: usage(100, 20),
			content: [{ type: "text", text: "x" }],
		},
	});
	h.flushDeferred();
	const assistant = h.appended.find((record) => record.kind === "assistant");
	assert.equal(assistant?.kind, "assistant");
	if (assistant?.kind !== "assistant") return;
	assert.equal(assistant.ttftMs, 100);
	assert.equal(assistant.durationMs, 200);
	assert.equal(assistant.streamingMs, 100);
});

test("publishes and clears English live footer state", async () => {
	const h = harness();
	await h.emit("session_start");
	await startTurn(h);
	assert.equal(h.intervalCount(), 1);
	h.setTime(1_500, 520);
	h.tickLive();
	assert.match(h.statuses.at(-1)?.content ?? "", /^◷ /);
	assert.ok(h.stateEvents.some((event: any) => event.active === true));
	await h.emit("agent_settled");
	assert.equal(h.intervalCount(), 0);
	assert.equal(h.statuses.at(-1)?.content, undefined);
});

test("measures extension UI wait inside the settled cycle", async () => {
	const h = harness();
	await h.emit("session_start");
	await startTurn(h);
	h.setTime(2_000, 1_020);
	await h.emit("ui_prompt_start", { kind: "select" });
	h.setTime(4_500, 3_520);
	await h.emit("ui_prompt_end", { kind: "select" });
	h.setTime(5_000, 4_020);
	await h.emit("agent_settled");
	h.flushDeferred();
	const cycle = h.appended.find((record) => record.kind === "cycle");
	assert.equal(cycle?.kind, "cycle");
	if (cycle?.kind === "cycle") assert.equal(cycle.userWaitMs, 2_500);
});

test("does not append deferred records after session shutdown", async () => {
	const h = harness();
	await h.emit("session_start");
	h.setTime(10_000, 100);
	await h.emit("input", { text: "Hello" });
	await h.emit("message_end", { message: { role: "user", timestamp: 10_000 } });
	assert.equal(h.deferredCount(), 1);
	await h.emit("session_shutdown", { reason: "quit" });
	assert.equal(h.deferredCount(), 0);
	h.flushDeferred();
	assert.deepEqual(h.appended, []);
});

test("does not leak state or deferred entries across session switches", async () => {
	const h = harness();
	await h.emit("session_start");
	h.setTime(100, 100);
	await h.emit("input", { text: "old" });
	await h.emit("message_end", { message: { role: "user", timestamp: 100 } });
	await h.emit("session_start", { reason: "switch" });
	h.flushDeferred();
	assert.deepEqual(h.appended, []);
	assert.equal(h.intervalCount(), 0);
});

test("a rejected idle submission does not contaminate the next cycle", async () => {
	const h = harness();
	await h.emit("session_start");
	h.setTime(100, 100);
	await h.emit("input", { text: "rejected" });
	h.setTime(500, 500);
	await h.emit("input", { text: "accepted" });
	await h.emit("agent_start");
	h.setTime(510, 510);
	await h.emit("message_end", { message: { role: "user", timestamp: 510 } });
	h.flushDeferred();
	h.setTime(700, 700);
	await h.emit("agent_settled");
	h.flushDeferred();
	const user = h.appended.find((record) => record.kind === "user");
	assert.equal(user?.kind === "user" ? user.submittedAt : undefined, 500);
	const cycle = h.appended.find((record) => record.kind === "cycle");
	assert.equal(cycle?.kind === "cycle" ? cycle.startedAt : undefined, 500);
});

test("renders legacy V1 entries with the V2 renderer", async () => {
	const h = harness();
	await h.emit("session_start");
	const text = h.render({
		kind: "tool",
		toolCallId: "old",
		toolName: "read",
		startedAt: 10,
		endedAt: 20,
		durationMs: 10,
		status: "success",
	});
	assert.match(text, /read/);
	assert.doesNotMatch(text, /tok —/);
});

test("applies mutable display and live settings without re-registering", async () => {
	let settings: TimingSettings = { ...DEFAULT_TIMING_SETTINGS, display: "off", live: false };
	const h = harness(() => settings);
	await h.emit("session_start");
	const user = {
		schemaVersion: 2 as const,
		cycleId: "cycle",
		sequence: 1,
		kind: "user" as const,
		submittedAt: 1,
		messageAt: 2,
	};
	assert.equal(h.render(user), "");
	settings = { ...settings, display: "compact", showMilliseconds: false };
	assert.doesNotMatch(h.render(user), /\.001/);
	h.setTime(100, 100);
	await h.emit("input", { text: "hello" });
	h.setIdle(false);
	await h.emit("agent_start");
	assert.equal(h.intervalCount(), 0);
});

test("session switches discard active parallel tool state and timers", async () => {
	const h = harness();
	await h.emit("session_start", { reason: "startup" });
	await startTurn(h);
	h.setTime(1_100, 110);
	await h.emit("tool_execution_start", { toolCallId: "old-a", toolName: "read" });
	h.setTime(1_110, 120);
	await h.emit("tool_execution_start", { toolCallId: "old-b", toolName: "bash" });
	h.setTime(1_200, 210);
	await h.emit("tool_execution_end", {
		toolCallId: "old-b",
		toolName: "bash",
		result: { aborted: true },
		isError: true,
	});
	await h.emit("session_start", { reason: "switch" });
	h.flushDeferred();
	assert.deepEqual(
		h.appended.map((record) => record.kind),
		["user"],
	);
	assert.equal(h.intervalCount(), 0);
	assert.ok(h.stateEvents.some((event: any) => event.active === false));
});
