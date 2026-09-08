import { performance } from "node:perf_hooks";
import {
	type ClockReading,
	coerceTimingRecord,
	formatLiveSnapshot,
	formatTimingRecord,
	isMeaningfulAssistantEvent,
	type TimingRecord,
	TimingTracker,
} from "./core.ts";
import { summarizeTiming, type TimingSummary, timingRecordsFromEntries } from "./reporting.ts";
import { DEFAULT_TIMING_SETTINGS, type TimingSettings } from "./settings.ts";

export const ENTRY_TYPE = "message-timing";
export const LIVE_STATUS = "message-timing-live";
export const STATE_EVENT = "message-timing:state";
export const REQUEST_STATE_EVENT = "message-timing:request-state";

interface TimingTheme {
	fg: (color: string, text: string) => string;
}

interface TimingContext {
	mode: string;
	isIdle: () => boolean;
	sessionManager?: { getBranch: () => readonly unknown[] };
	ui: {
		theme: TimingTheme;
		setStatus: (key: string, content: string | undefined) => void;
	};
}

interface EventBus {
	on: (event: string, handler: (data: unknown) => void) => void;
	emit: (event: string, data: unknown) => void;
}

export interface TimingPi {
	on: (event: string, handler: (event: any, ctx: TimingContext) => unknown) => void;
	appendEntry: <T>(customType: string, data: T) => string | undefined;
	registerEntryRenderer: <T>(
		customType: string,
		renderer: (entry: { data?: T }, options: { expanded: boolean }, theme: TimingTheme) => unknown,
	) => void;
	events?: EventBus;
}

export interface RuntimeOptions {
	getSettings?: () => TimingSettings;
}

export interface RuntimeDependencies {
	wallNow: () => number;
	monoNow: () => number;
	defer: (callback: () => void) => unknown;
	cancelDeferred: (handle: unknown) => void;
	every: (callback: () => void, intervalMs: number) => unknown;
	cancelEvery: (handle: unknown) => void;
	createComponent: (render: (width: number) => string[]) => unknown;
}

const runtimeDefaults: RuntimeDependencies = {
	wallNow: Date.now,
	monoNow: () => performance.now(),
	defer(callback) {
		const handle = setTimeout(callback, 0);
		handle.unref?.();
		return handle;
	},
	cancelDeferred(handle) {
		clearTimeout(handle as ReturnType<typeof setTimeout>);
	},
	every(callback, intervalMs) {
		const handle = setInterval(callback, intervalMs);
		handle.unref?.();
		return handle;
	},
	cancelEvery(handle) {
		clearInterval(handle as ReturnType<typeof setInterval>);
	},
	createComponent(render) {
		return { render, invalidate() {} };
	},
};

export function registerMessageTiming(
	pi: TimingPi,
	overrides: Partial<RuntimeDependencies> = {},
	options: RuntimeOptions = {},
): void {
	const runtime = { ...runtimeDefaults, ...overrides };
	const getSettings = options.getSettings ?? (() => DEFAULT_TIMING_SETTINGS);
	const tracker = new TimingTracker();
	const submittedAt: ClockReading[] = [];
	const deferred = new Set<unknown>();
	let liveInterval: unknown;
	let liveContext: TimingContext | undefined;
	let sessionActive = false;
	let activeTurnIndex = -1;
	let sessionRecords: TimingRecord[] = [];
	let lastState: Record<string, unknown> = { schemaVersion: 1, active: false };

	const clock = (wallOverride?: unknown): ClockReading => ({
		wallMs: typeof wallOverride === "number" && Number.isFinite(wallOverride) ? wallOverride : runtime.wallNow(),
		monoMs: runtime.monoNow(),
	});

	const sessionState = (summary: TimingSummary) => ({
		cycles: summary.cycles,
		assistantSteps: summary.assistantSteps,
		tools: summary.tools,
		usage: summary.usage,
		cost: summary.cost,
		failures: summary.failures,
		aborted: summary.aborted,
	});

	const publishState = (state: Record<string, unknown>) => {
		lastState = { schemaVersion: 1, session: sessionState(summarizeTiming(sessionRecords)), ...state };
		pi.events?.emit(STATE_EVENT, lastState);
	};

	pi.events?.on(REQUEST_STATE_EVENT, () => {
		pi.events?.emit(STATE_EVENT, lastState);
	});

	const renderLive = () => {
		const ctx = liveContext;
		if (!ctx) return;
		const settings = getSettings();
		const snapshot = tracker.live(clock());
		if (!snapshot || !settings.live) {
			ctx.ui.setStatus(LIVE_STATUS, undefined);
			if (!settings.live && liveInterval !== undefined) {
				runtime.cancelEvery(liveInterval);
				liveInterval = undefined;
			}
			publishState({ active: false });
			return;
		}
		const text = `◷ ${formatLiveSnapshot(snapshot)}`;
		ctx.ui.setStatus(LIVE_STATUS, ctx.ui.theme.fg("dim", text));
		publishState({
			active: true,
			phase: snapshot.phase,
			elapsedMs: snapshot.elapsedMs,
			activeTool: snapshot.activeTools.length === 1 ? snapshot.activeTools[0]?.toolName : undefined,
			activeTools: snapshot.activeTools.map((tool) => tool.toolName),
			activeToolCount: snapshot.activeTools.length,
			usage: snapshot.streamingUsage,
			text,
		});
	};

	const startLive = (ctx: TimingContext) => {
		liveContext = ctx;
		renderLive();
		if (!getSettings().live || liveInterval !== undefined) return;
		liveInterval = runtime.every(renderLive, 250);
	};

	const stopLive = () => {
		if (liveInterval !== undefined) runtime.cancelEvery(liveInterval);
		liveInterval = undefined;
		liveContext?.ui.setStatus(LIVE_STATUS, undefined);
		liveContext = undefined;
		publishState({ active: false });
	};

	const appendLater = (record: TimingRecord) => {
		sessionRecords.push(record);
		let handle: unknown;
		handle = runtime.defer(() => {
			deferred.delete(handle);
			if (sessionActive) pi.appendEntry<TimingRecord>(ENTRY_TYPE, record);
		});
		deferred.add(handle);
	};

	const cancelDeferred = () => {
		for (const handle of deferred) runtime.cancelDeferred(handle);
		deferred.clear();
	};

	pi.registerEntryRenderer<unknown>(ENTRY_TYPE, (entry, { expanded }, theme) => {
		const record = coerceTimingRecord(entry.data);
		if (!record) return runtime.createComponent(() => []);
		return runtime.createComponent((width) => {
			const settings = getSettings();
			if (settings.display === "off") return [];
			const lines = formatTimingRecord(record, expanded || settings.display === "detailed", Math.max(1, width - 4), {
				showCost: settings.showCost,
				showMilliseconds: settings.showMilliseconds,
			});
			return lines.map((line, index) => {
				if ((record.kind === "cycle" || record.kind === "batch" || record.kind === "step") && index === 0) {
					const status = record.status;
					const color = status === "success" ? "success" : status === "aborted" ? "warning" : "error";
					return theme.fg(color, line);
				}
				return theme.fg("dim", line);
			});
		});
	});

	pi.on("session_start", (_event, ctx) => {
		if (liveContext) stopLive();
		cancelDeferred();
		tracker.reset();
		submittedAt.length = 0;
		activeTurnIndex = -1;
		sessionRecords = ctx.sessionManager ? timingRecordsFromEntries(ctx.sessionManager.getBranch()) : [];
		sessionActive = true;
		liveContext = ctx;
		ctx.ui.setStatus(LIVE_STATUS, undefined);
		publishState({ active: false });
	});

	pi.on("input", (_event, ctx) => {
		const at = clock();
		if (ctx.isIdle() && tracker.hasActiveCycle()) {
			tracker.reset();
			submittedAt.length = 0;
			stopLive();
		}
		tracker.startSubmission(at);
		submittedAt.push(at);
	});

	pi.on("agent_start", (_event, ctx) => {
		tracker.startAgent(clock());
		startLive(ctx);
	});

	pi.on("turn_start", (event, ctx) => {
		activeTurnIndex = event.turnIndex;
		tracker.startTurn(event.turnIndex, clock(event.timestamp));
		startLive(ctx);
	});

	pi.on("message_update", (event) => {
		if (event.message.role !== "assistant") return;
		if (isMeaningfulAssistantEvent(event.assistantMessageEvent)) {
			tracker.markFirstOutput(activeTurnIndex, clock());
		}
		tracker.updateStreamingUsage(event.message.usage);
		renderLive();
	});

	pi.on("message_end", (event) => {
		const at = clock();
		if (event.message.role === "user") {
			const fallback = clock(event.message.timestamp);
			appendLater(tracker.createUserRecord(submittedAt.shift() ?? fallback));
			return;
		}
		if (event.message.role === "assistant") {
			tracker.finishAssistant(event.message as Record<string, unknown>, at);
			return;
		}
		if (event.message.role === "toolResult") {
			tracker.consumeToolResult(event.message.toolCallId, event.message, event.message.isError);
		}
	});

	pi.on("turn_end", (event) => {
		const stepRecord = tracker.finishTurn(event.turnIndex);
		if (stepRecord) appendLater(stepRecord);
		if (activeTurnIndex === event.turnIndex) activeTurnIndex = -1;
	});

	pi.on("tool_execution_start", (event, ctx) => {
		tracker.startTool(event.toolCallId, event.toolName, clock());
		startLive(ctx);
	});

	pi.on("tool_execution_end", (event) => {
		tracker.finishTool(event.toolCallId, event.toolName, event.result, event.isError, clock());
		renderLive();
	});

	pi.on("ui_prompt_start", () => {
		tracker.startUserPrompt(clock());
		renderLive();
	});

	pi.on("ui_prompt_end", () => {
		tracker.endUserPrompt(clock());
		renderLive();
	});

	pi.on("agent_settled", () => {
		const at = clock();
		for (const record of tracker.finishOutstandingTools(at)) appendLater(record);
		const cycle = tracker.settle(at);
		stopLive();
		if (cycle) {
			appendLater(cycle);
			publishState({
				active: false,
				lastCycle: {
					durationMs: cycle.durationMs,
					usage: cycle.totalUsage,
					billingMode: cycle.billingMode,
					status: cycle.status,
				},
			});
		}
	});

	pi.on("session_shutdown", () => {
		sessionActive = false;
		stopLive();
		cancelDeferred();
		tracker.reset();
		submittedAt.length = 0;
		sessionRecords = [];
		activeTurnIndex = -1;
	});
}
