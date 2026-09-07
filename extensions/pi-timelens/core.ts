export const TIMING_SCHEMA_VERSION = 2 as const;

export interface ClockReading {
	wallMs: number;
	monoMs: number;
}

export interface CostSnapshot {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
}

export interface UsageFieldPresence {
	input: boolean;
	output: boolean;
	cacheRead: boolean;
	cacheWrite: boolean;
	totalTokens: boolean;
}

export interface UsageSnapshot {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost?: CostSnapshot;
	/** Omitted means every token category is exact (V1/V2 compatibility). */
	reported?: UsageFieldPresence;
}

export type BillingMode = "metered" | "subscription" | "mixed" | "unknown";
export type ToolStatus = "success" | "error" | "aborted";
export type CycleStatus = "success" | "failed" | "aborted";

interface RecordBase {
	schemaVersion: typeof TIMING_SCHEMA_VERSION;
	/** Preserves whether a replayed record originated in the V1 schema. */
	sourceSchemaVersion?: 1 | 2;
	cycleId: string;
	sequence: number;
}

export interface UserTimingRecord extends RecordBase {
	kind: "user";
	submittedAt: number;
}

export interface AssistantTimingRecord extends RecordBase {
	kind: "assistant";
	turnIndex: number;
	startedAt: number;
	endedAt: number;
	durationMs: number;
	ttftMs?: number;
	streamingMs?: number;
	outputTokensPerSecond?: number;
	usage?: UsageSnapshot;
	provider?: string;
	model?: string;
	billingMode: BillingMode;
	stopReason?: string;
}

export interface ToolTimingRecord extends RecordBase {
	kind: "tool";
	turnIndex: number;
	toolCallId: string;
	toolName: string;
	startedAt: number;
	endedAt: number;
	durationMs: number;
	usage?: UsageSnapshot;
	billingMode: BillingMode;
	status: ToolStatus;
}

export interface BatchTimingRecord extends RecordBase {
	kind: "batch";
	turnIndex: number;
	batchId: string;
	startedAt: number;
	endedAt: number;
	wallMs: number;
	workMs: number;
	status: ToolStatus;
	tools: ToolTimingRecord[];
}

export interface CycleTimingRecord extends RecordBase {
	kind: "cycle";
	startedAt: number;
	endedAt: number;
	durationMs: number;
	assistantDurationMs: number;
	toolWallMs: number;
	toolWorkMs: number;
	assistantSteps: number;
	toolCalls: number;
	toolFailures: number;
	toolAborts: number;
	submissions: number;
	userWaitMs: number;
	retryWaitMs: number;
	assistantUsage?: UsageSnapshot;
	toolUsage?: UsageSnapshot;
	totalUsage?: UsageSnapshot;
	billingMode: BillingMode;
	status: CycleStatus;
}

export type TimingRecord =
	| UserTimingRecord
	| AssistantTimingRecord
	| ToolTimingRecord
	| BatchTimingRecord
	| CycleTimingRecord;

interface ActiveCycle {
	id: string;
	started: ClockReading;
	sequence: number;
	assistantDurationMs: number;
	assistantSteps: number;
	toolCalls: number;
	toolFailures: number;
	toolAborts: number;
	submissions: number;
	userWaitMs: number;
	retryWaitMs: number;
	assistantUsage?: UsageSnapshot;
	toolUsage?: UsageSnapshot;
	billingMode: BillingMode;
	status: CycleStatus;
	toolIntervals: Array<{ start: number; end: number }>;
}

interface ActiveTurn {
	turnIndex: number;
	started: ClockReading;
	firstOutput?: ClockReading;
	toolCallIds: string[];
}

interface ActiveTool {
	toolCallId: string;
	toolName: string;
	turnIndex: number;
	started: ClockReading;
}

interface CompletedTool {
	record: ToolTimingRecord;
	startMono: number;
	endMono: number;
	accounted: boolean;
	consumed: boolean;
}

export interface LiveSnapshot {
	startedAt: number;
	elapsedMs: number;
	phase: "assistant" | "tool" | "waiting" | "running";
	activeTools: Array<{ toolName: string; startedAt: number; elapsedMs: number }>;
	streamingUsage?: UsageSnapshot;
}

function finiteNonNegative(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function hasFiniteNumber(record: Record<string, unknown>, key: string): boolean {
	return typeof record[key] === "number" && Number.isFinite(record[key]);
}

export function normalizeCost(value: unknown): CostSnapshot | undefined {
	if (!value || typeof value !== "object") return undefined;
	const cost = value as Record<string, unknown>;
	const completeComponents = ["input", "output", "cacheRead", "cacheWrite"].every((key) => hasFiniteNumber(cost, key));
	if (!hasFiniteNumber(cost, "total") && !completeComponents) return undefined;
	const input = finiteNonNegative(cost.input);
	const output = finiteNonNegative(cost.output);
	const cacheRead = finiteNonNegative(cost.cacheRead);
	const cacheWrite = finiteNonNegative(cost.cacheWrite);
	const reportedTotal = finiteNonNegative(cost.total);
	const total = reportedTotal || input + output + cacheRead + cacheWrite;
	if (total === 0) return undefined;
	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		total,
	};
}

export function normalizeUsage(value: unknown): UsageSnapshot | undefined {
	if (!value || typeof value !== "object") return undefined;
	const usage = value as Record<string, unknown>;
	if (!["input", "output", "cacheRead", "cacheWrite", "totalTokens"].some((key) => hasFiniteNumber(usage, key))) {
		return undefined;
	}
	const input = finiteNonNegative(usage.input);
	const output = finiteNonNegative(usage.output);
	const cacheRead = finiteNonNegative(usage.cacheRead);
	const cacheWrite = finiteNonNegative(usage.cacheWrite);
	const reported = {
		input: hasFiniteNumber(usage, "input"),
		output: hasFiniteNumber(usage, "output"),
		cacheRead: hasFiniteNumber(usage, "cacheRead"),
		cacheWrite: hasFiniteNumber(usage, "cacheWrite"),
		totalTokens: hasFiniteNumber(usage, "totalTokens"),
	};
	const completeCategories = reported.input && reported.output && reported.cacheRead && reported.cacheWrite;
	const reportedTotal = finiteNonNegative(usage.totalTokens);
	reported.totalTokens = reported.totalTokens || completeCategories;
	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens: hasFiniteNumber(usage, "totalTokens") ? reportedTotal : input + output + cacheRead + cacheWrite,
		cost: normalizeCost(usage.cost),
		reported: Object.values(reported).every(Boolean) ? undefined : reported,
	};
}

function cloneUsage(usage: UsageSnapshot): UsageSnapshot {
	return {
		...usage,
		cost: usage.cost ? { ...usage.cost } : undefined,
		reported: usage.reported ? { ...usage.reported } : undefined,
	};
}

function usageFieldReported(usage: UsageSnapshot, field: keyof UsageFieldPresence): boolean {
	return usage.reported?.[field] !== false;
}

function addCost(left?: CostSnapshot, right?: CostSnapshot): CostSnapshot | undefined {
	if (!left) return right ? { ...right } : undefined;
	if (!right) return { ...left };
	return {
		input: left.input + right.input,
		output: left.output + right.output,
		cacheRead: left.cacheRead + right.cacheRead,
		cacheWrite: left.cacheWrite + right.cacheWrite,
		total: left.total + right.total,
	};
}

export function addUsage(left?: UsageSnapshot, right?: UsageSnapshot): UsageSnapshot | undefined {
	if (!left) return right ? cloneUsage(right) : undefined;
	if (!right) return cloneUsage(left);
	const reported: UsageFieldPresence = {
		input: usageFieldReported(left, "input") && usageFieldReported(right, "input"),
		output: usageFieldReported(left, "output") && usageFieldReported(right, "output"),
		cacheRead: usageFieldReported(left, "cacheRead") && usageFieldReported(right, "cacheRead"),
		cacheWrite: usageFieldReported(left, "cacheWrite") && usageFieldReported(right, "cacheWrite"),
		totalTokens: usageFieldReported(left, "totalTokens") && usageFieldReported(right, "totalTokens"),
	};
	return {
		input: left.input + right.input,
		output: left.output + right.output,
		cacheRead: left.cacheRead + right.cacheRead,
		cacheWrite: left.cacheWrite + right.cacheWrite,
		totalTokens: left.totalTokens + right.totalTokens,
		cost: addCost(left.cost, right.cost),
		reported: Object.values(reported).every(Boolean) ? undefined : reported,
	};
}

export function mergeBilling(left: BillingMode, right: BillingMode): BillingMode {
	if (left === "unknown") return right;
	if (right === "unknown") return left;
	if (left === right) return left;
	return "mixed";
}

function withoutSubscriptionCost(
	usage: UsageSnapshot | undefined,
	billingMode: BillingMode,
): UsageSnapshot | undefined {
	if (!usage) return undefined;
	const copy = cloneUsage(usage);
	if (billingMode === "subscription") copy.cost = undefined;
	return copy;
}

export function addUsageByBilling(
	left: UsageSnapshot | undefined,
	leftBilling: BillingMode,
	right: UsageSnapshot | undefined,
	rightBilling: BillingMode,
): UsageSnapshot | undefined {
	return addUsage(withoutSubscriptionCost(left, leftBilling), withoutSubscriptionCost(right, rightBilling));
}

export function billingModeFor(provider: unknown, usage?: UsageSnapshot): BillingMode {
	if (provider === "openai-codex") return "subscription";
	if (usage?.cost) return "metered";
	return "unknown";
}

function providerFromModel(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const separator = value.indexOf("/");
	return separator > 0 ? value.slice(0, separator) : undefined;
}

function toolTelemetry(value: unknown): {
	usage: UsageSnapshot | undefined;
	billingMode: BillingMode;
} {
	if (!value || typeof value !== "object") return { usage: undefined, billingMode: "unknown" };
	const record = value as Record<string, unknown>;
	const details =
		record.details && typeof record.details === "object" ? (record.details as Record<string, unknown>) : undefined;
	const results = Array.isArray(details?.results)
		? details.results.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
		: [];
	let nestedUsage: UsageSnapshot | undefined;
	let nestedBillingMode: BillingMode = "unknown";
	let nestedUnknownBilling = false;
	for (const result of results) {
		const usage = normalizeUsage(result.usage);
		if (!usage) continue;
		const billingMode = billingModeFor(result.provider ?? providerFromModel(result.model), usage);
		nestedUnknownBilling ||= billingMode === "unknown";
		nestedUsage = addUsageByBilling(nestedUsage, nestedBillingMode, usage, billingMode);
		nestedBillingMode = mergeBilling(nestedBillingMode, billingMode);
	}

	const directUsage = normalizeUsage(record.usage) ?? normalizeUsage(details?.usage);
	if (!directUsage) return { usage: nestedUsage, billingMode: nestedBillingMode };
	const directProvider = record.provider ?? details?.provider;
	if (directProvider !== undefined) {
		return { usage: directUsage, billingMode: billingModeFor(directProvider, directUsage) };
	}
	if (nestedUsage && nestedBillingMode !== "unknown") {
		const usage = cloneUsage(directUsage);
		if (nestedBillingMode === "mixed" || nestedUnknownBilling) {
			usage.cost = nestedUsage.cost ? { ...nestedUsage.cost } : undefined;
		}
		return { usage, billingMode: nestedBillingMode };
	}
	return { usage: directUsage, billingMode: billingModeFor(undefined, directUsage) };
}

function safeWall(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function elapsed(start: ClockReading, end: ClockReading): number {
	return Math.max(0, end.monoMs - start.monoMs);
}

function hasCanonicalAbortMarker(value: unknown): boolean {
	if (typeof value === "string") {
		return /(?:^|\b)(?:operation|request|tool execution) (?:was )?aborted\b/i.test(value);
	}
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	if (record.name === "AbortError" || record.code === "ABORT_ERR") return true;
	return [record.message, record.error, record.text].some(hasCanonicalAbortMarker);
}

function toolWasAborted(result: unknown, isError: boolean): boolean {
	if (!result || typeof result !== "object") return false;
	const record = result as Record<string, unknown>;
	if (record.cancelled === true || record.aborted === true) return true;
	const details =
		record.details && typeof record.details === "object" ? (record.details as Record<string, unknown>) : undefined;
	if (details?.cancelled === true || details?.aborted === true || hasCanonicalAbortMarker(details)) return true;
	if (!isError) return false;
	if (hasCanonicalAbortMarker(record)) return true;
	return Array.isArray(record.content) && record.content.some(hasCanonicalAbortMarker);
}

export function isMeaningfulAssistantEvent(value: unknown): boolean {
	if (!value || typeof value !== "object") return false;
	const event = value as Record<string, unknown>;
	if (!["text_delta", "thinking_delta", "toolcall_delta"].includes(String(event.type))) return false;
	return typeof event.delta !== "string" || event.delta.length > 0;
}

function messageHasContent(message: Record<string, unknown>): boolean {
	if (!Array.isArray(message.content)) return false;
	return message.content.some((block) => {
		if (!block || typeof block !== "object") return false;
		const item = block as Record<string, unknown>;
		if (item.type === "text" || item.type === "thinking") return typeof item.text === "string" && item.text.length > 0;
		return item.type === "toolCall" || item.type === "tool_use";
	});
}

function unionDuration(intervals: Array<{ start: number; end: number }>): number {
	if (intervals.length === 0) return 0;
	const sorted = intervals
		.map((interval) => ({ start: Math.min(interval.start, interval.end), end: Math.max(interval.start, interval.end) }))
		.sort((left, right) => left.start - right.start || left.end - right.end);
	let total = 0;
	let start = sorted[0]!.start;
	let end = sorted[0]!.end;
	for (const interval of sorted.slice(1)) {
		if (interval.start <= end) {
			end = Math.max(end, interval.end);
		} else {
			total += end - start;
			start = interval.start;
			end = interval.end;
		}
	}
	return total + end - start;
}

export class TimingTracker {
	private cycle?: ActiveCycle;
	private cycleCounter = 0;
	private activeTurnIndex?: number;
	private readonly turns = new Map<number, ActiveTurn>();
	private readonly activeTools = new Map<string, ActiveTool>();
	private readonly completedTools = new Map<string, CompletedTool>();
	private assistantStreaming = false;
	private streamingUsage?: UsageSnapshot;
	private promptStarted?: ClockReading;
	private retryWaitingSince?: ClockReading;

	hasActiveCycle(): boolean {
		return this.cycle !== undefined;
	}

	startSubmission(at: ClockReading): void {
		if (!this.cycle) this.cycle = this.newCycle(at);
		this.cycle.submissions += 1;
	}

	createUserRecord(submitted: ClockReading): UserTimingRecord {
		return { ...this.nextBase(submitted), kind: "user", submittedAt: submitted.wallMs };
	}

	startAgent(at: ClockReading): void {
		this.ensureCycle(at);
		if (this.retryWaitingSince && this.cycle) {
			this.cycle.retryWaitMs += elapsed(this.retryWaitingSince, at);
			this.retryWaitingSince = undefined;
		}
	}

	startTurn(turnIndex: number, at: ClockReading): void {
		this.ensureCycle(at);
		this.activeTurnIndex = turnIndex;
		this.turns.set(turnIndex, { turnIndex, started: at, toolCallIds: [] });
		this.assistantStreaming = true;
		this.streamingUsage = undefined;
	}

	markFirstOutput(turnIndex: number, at: ClockReading): void {
		const turn = this.turns.get(turnIndex);
		if (turn && !turn.firstOutput) turn.firstOutput = at;
	}

	updateStreamingUsage(value: unknown): void {
		this.streamingUsage = normalizeUsage(value);
	}

	finishAssistant(message: Record<string, unknown>, at: ClockReading): AssistantTimingRecord {
		const turnIndex = this.activeTurnIndex ?? -1;
		const turn = this.turns.get(turnIndex) ?? { turnIndex, started: at, toolCallIds: [] };
		if (!turn.firstOutput && messageHasContent(message)) turn.firstOutput = at;
		const durationMs = elapsed(turn.started, at);
		const stopReason = typeof message.stopReason === "string" ? message.stopReason : undefined;
		const normalizedUsage = normalizeUsage(message.usage);
		const usage =
			(stopReason === "error" || stopReason === "aborted") && normalizedUsage?.totalTokens === 0
				? undefined
				: normalizedUsage;
		const provider = typeof message.provider === "string" ? message.provider : undefined;
		const billingMode = billingModeFor(provider, usage);
		const cycle = this.ensureCycle(turn.started);
		cycle.assistantSteps += 1;
		cycle.assistantDurationMs += durationMs;
		cycle.assistantUsage = addUsageByBilling(cycle.assistantUsage, cycle.billingMode, usage, billingMode);
		cycle.billingMode = mergeBilling(cycle.billingMode, billingMode);
		if (stopReason === "aborted") cycle.status = "aborted";
		else if (stopReason === "error" && cycle.status === "success") cycle.status = "failed";
		else if (stopReason !== "error" && cycle.status === "failed") cycle.status = "success";
		if (stopReason === "error") this.retryWaitingSince = at;

		this.assistantStreaming = false;
		this.streamingUsage = undefined;
		const ttftMs = turn.firstOutput ? elapsed(turn.started, turn.firstOutput) : undefined;
		const streamingMs = turn.firstOutput ? elapsed(turn.firstOutput, at) : undefined;
		const outputTokensPerSecond =
			usage && usageFieldReported(usage, "output") && streamingMs && streamingMs > 0
				? usage.output / (streamingMs / 1_000)
				: undefined;
		return {
			...this.nextBase(turn.started),
			kind: "assistant",
			turnIndex,
			startedAt: turn.started.wallMs,
			endedAt: Math.max(turn.started.wallMs, at.wallMs),
			durationMs,
			ttftMs,
			streamingMs,
			outputTokensPerSecond,
			usage,
			provider,
			model: typeof message.model === "string" ? message.model : undefined,
			billingMode,
			stopReason,
		};
	}

	startTool(toolCallId: string, toolName: string, at: ClockReading): void {
		this.ensureCycle(at);
		const turnIndex = this.activeTurnIndex ?? -1;
		let turn = this.turns.get(turnIndex);
		if (!turn) {
			turn = { turnIndex, started: at, toolCallIds: [] };
			this.turns.set(turnIndex, turn);
		}
		if (!turn.toolCallIds.includes(toolCallId)) turn.toolCallIds.push(toolCallId);
		this.activeTools.set(toolCallId, { toolCallId, toolName, turnIndex, started: at });
	}

	finishTool(
		toolCallId: string,
		toolName: string,
		result: unknown,
		isError: boolean,
		at: ClockReading,
	): ToolTimingRecord {
		const active = this.activeTools.get(toolCallId);
		const started = active?.started ?? at;
		const turnIndex = active?.turnIndex ?? this.activeTurnIndex ?? -1;
		const status = toolWasAborted(result, isError) ? "aborted" : isError ? "error" : "success";
		const telemetry = toolTelemetry(result);
		const record: ToolTimingRecord = {
			...this.nextBase(started),
			kind: "tool",
			turnIndex,
			toolCallId,
			toolName: active?.toolName ?? toolName,
			startedAt: started.wallMs,
			endedAt: Math.max(started.wallMs, at.wallMs),
			durationMs: elapsed(started, at),
			usage: telemetry.usage,
			billingMode: telemetry.billingMode,
			status,
		};
		this.activeTools.delete(toolCallId);
		this.completedTools.set(toolCallId, {
			record,
			startMono: started.monoMs,
			endMono: Math.max(started.monoMs, at.monoMs),
			accounted: false,
			consumed: false,
		});
		return record;
	}

	consumeToolResult(toolCallId: string, result: unknown, isError: boolean): ToolTimingRecord | undefined {
		const completed = this.completedTools.get(toolCallId);
		if (!completed) return undefined;
		const telemetry = toolTelemetry(result);
		if (telemetry.usage) {
			const currentBilling = completed.record.billingMode;
			const conflictingFallback =
				currentBilling !== "unknown" &&
				telemetry.billingMode !== "unknown" &&
				currentBilling !== telemetry.billingMode &&
				telemetry.billingMode !== "mixed";
			if (conflictingFallback) {
				const usage = cloneUsage(telemetry.usage);
				usage.cost = completed.record.usage?.cost ? { ...completed.record.usage.cost } : undefined;
				completed.record.usage = usage;
			} else {
				completed.record.usage = telemetry.usage;
			}
			if (currentBilling === "unknown" || telemetry.billingMode === "mixed") {
				completed.record.billingMode = telemetry.billingMode;
			}
		}
		if (isError && completed.record.status === "success") completed.record.status = "error";
		completed.consumed = true;
		this.accountTool(completed);
		return cloneTool(completed.record);
	}

	finishTurn(turnIndex: number): ToolTimingRecord | BatchTimingRecord | undefined {
		const turn = this.turns.get(turnIndex);
		this.turns.delete(turnIndex);
		if (this.activeTurnIndex === turnIndex) this.activeTurnIndex = undefined;
		if (!turn || turn.toolCallIds.length === 0) return undefined;
		const completed = turn.toolCallIds
			.map((id) => this.completedTools.get(id))
			.filter((item): item is CompletedTool => item !== undefined);
		if (completed.length === 0) return undefined;
		for (const item of completed) {
			this.accountTool(item);
			this.completedTools.delete(item.record.toolCallId);
		}
		const tools = completed.map((item) => cloneTool(item.record));
		if (tools.length === 1) return tools[0];
		const first = completed.reduce((best, item) => (item.startMono < best.startMono ? item : best));
		const last = completed.reduce((best, item) => (item.endMono > best.endMono ? item : best));
		return {
			...this.nextBase({ wallMs: first.record.startedAt, monoMs: first.startMono }),
			kind: "batch",
			turnIndex,
			batchId: `${this.cycle?.id ?? "cycle"}:turn-${turnIndex}`,
			startedAt: first.record.startedAt,
			endedAt: last.record.endedAt,
			wallMs: Math.max(0, last.endMono - first.startMono),
			workMs: tools.reduce((sum, tool) => sum + tool.durationMs, 0),
			status: tools.some((tool) => tool.status === "aborted")
				? "aborted"
				: tools.some((tool) => tool.status === "error")
					? "error"
					: "success",
			tools,
		};
	}

	finishOutstandingTools(at: ClockReading): Array<ToolTimingRecord | BatchTimingRecord> {
		for (const active of [...this.activeTools.values()]) {
			this.finishTool(active.toolCallId, active.toolName, { aborted: true }, true, at);
		}
		for (const completed of this.completedTools.values()) {
			completed.consumed = true;
			this.accountTool(completed);
		}
		const records: Array<ToolTimingRecord | BatchTimingRecord> = [];
		for (const turnIndex of [...this.turns.keys()].sort((a, b) => a - b)) {
			const record = this.finishTurn(turnIndex);
			if (record) records.push(record);
		}
		for (const [toolCallId, completed] of this.completedTools) {
			records.push(cloneTool(completed.record));
			this.completedTools.delete(toolCallId);
		}
		return records;
	}

	startUserPrompt(at: ClockReading): void {
		if (this.cycle && !this.promptStarted) this.promptStarted = at;
	}

	endUserPrompt(at: ClockReading): void {
		if (!this.cycle || !this.promptStarted) return;
		this.cycle.userWaitMs += elapsed(this.promptStarted, at);
		this.promptStarted = undefined;
	}

	settle(at: ClockReading): CycleTimingRecord | undefined {
		if (!this.cycle) return undefined;
		this.endUserPrompt(at);
		const cycle = this.cycle;
		const totalUsage = addUsage(cycle.assistantUsage, cycle.toolUsage);
		const record: CycleTimingRecord = {
			...this.nextBase(cycle.started),
			kind: "cycle",
			startedAt: cycle.started.wallMs,
			endedAt: Math.max(cycle.started.wallMs, at.wallMs),
			durationMs: elapsed(cycle.started, at),
			assistantDurationMs: cycle.assistantDurationMs,
			toolWallMs: unionDuration(cycle.toolIntervals),
			toolWorkMs: cycle.toolIntervals.reduce((sum, interval) => sum + Math.max(0, interval.end - interval.start), 0),
			assistantSteps: cycle.assistantSteps,
			toolCalls: cycle.toolCalls,
			toolFailures: cycle.toolFailures,
			toolAborts: cycle.toolAborts,
			submissions: cycle.submissions,
			userWaitMs: cycle.userWaitMs,
			retryWaitMs: cycle.retryWaitMs,
			assistantUsage: cycle.assistantUsage,
			toolUsage: cycle.toolUsage,
			totalUsage,
			billingMode: cycle.billingMode,
			status: cycle.status,
		};
		this.reset();
		return record;
	}

	live(at: ClockReading): LiveSnapshot | undefined {
		if (!this.cycle) return undefined;
		const activeTools = [...this.activeTools.values()].map((tool) => ({
			toolName: tool.toolName,
			startedAt: tool.started.wallMs,
			elapsedMs: elapsed(tool.started, at),
		}));
		const phase: LiveSnapshot["phase"] = this.promptStarted
			? "waiting"
			: activeTools.length > 0
				? "tool"
				: this.assistantStreaming
					? "assistant"
					: "running";
		return {
			startedAt: this.cycle.started.wallMs,
			elapsedMs: elapsed(this.cycle.started, at),
			phase,
			activeTools,
			streamingUsage: this.streamingUsage,
		};
	}

	reset(): void {
		this.cycle = undefined;
		this.activeTurnIndex = undefined;
		this.turns.clear();
		this.activeTools.clear();
		this.completedTools.clear();
		this.assistantStreaming = false;
		this.streamingUsage = undefined;
		this.promptStarted = undefined;
		this.retryWaitingSince = undefined;
	}

	private ensureCycle(at: ClockReading): ActiveCycle {
		if (!this.cycle) this.cycle = this.newCycle(at);
		return this.cycle;
	}

	private newCycle(started: ClockReading): ActiveCycle {
		this.cycleCounter += 1;
		return {
			id: `cycle-${Math.trunc(started.wallMs)}-${this.cycleCounter}`,
			started,
			sequence: 0,
			assistantDurationMs: 0,
			assistantSteps: 0,
			toolCalls: 0,
			toolFailures: 0,
			toolAborts: 0,
			submissions: 0,
			userWaitMs: 0,
			retryWaitMs: 0,
			billingMode: "unknown",
			status: "success",
			toolIntervals: [],
		};
	}

	private nextBase(at: ClockReading): RecordBase {
		const cycle = this.ensureCycle(at);
		cycle.sequence += 1;
		return { schemaVersion: TIMING_SCHEMA_VERSION, cycleId: cycle.id, sequence: cycle.sequence };
	}

	private accountTool(completed: CompletedTool): void {
		if (completed.accounted) return;
		const cycle = this.ensureCycle({ wallMs: completed.record.startedAt, monoMs: completed.startMono });
		cycle.toolCalls += 1;
		if (completed.record.status === "error") {
			cycle.toolFailures += 1;
			if (cycle.status === "success") cycle.status = "failed";
		}
		if (completed.record.status === "aborted") {
			cycle.toolAborts += 1;
			cycle.status = "aborted";
		}
		cycle.toolUsage = addUsageByBilling(
			cycle.toolUsage,
			cycle.billingMode,
			completed.record.usage,
			completed.record.billingMode,
		);
		cycle.billingMode = mergeBilling(cycle.billingMode, completed.record.billingMode);
		cycle.toolIntervals.push({ start: completed.startMono, end: completed.endMono });
		completed.accounted = true;
	}
}

function cloneTool(record: ToolTimingRecord): ToolTimingRecord {
	return {
		...record,
		usage: record.usage ? cloneUsage(record.usage) : undefined,
	};
}

const integerFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function formatTimestamp(epochMs: number, showMilliseconds = true): string {
	const date = new Date(epochMs);
	const part = (value: number, width = 2) => String(value).padStart(width, "0");
	const base = `${part(date.getHours())}:${part(date.getMinutes())}:${part(date.getSeconds())}`;
	return showMilliseconds ? `${base}.${part(date.getMilliseconds(), 3)}` : base;
}

export function formatDuration(durationMs: number): string {
	const safe = Math.max(0, durationMs);
	if (safe < 1_000) return `${Math.round(safe)}ms`;
	if (safe < 10_000) return `${(safe / 1_000).toFixed(2)}s`;
	if (safe < 60_000) return `${(safe / 1_000).toFixed(1)}s`;
	const minutes = Math.floor(safe / 60_000);
	const seconds = Math.round((safe % 60_000) / 1_000);
	return `${minutes}m ${seconds}s`;
}

export function formatCompactTokens(tokens: number): string {
	const safe = Math.max(0, tokens);
	if (safe < 1_000) return integerFormat.format(safe);
	if (safe < 1_000_000) return `${(safe / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
	return `${(safe / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}

function formatUsageField(usage: UsageSnapshot, field: keyof UsageFieldPresence): string {
	return usageFieldReported(usage, field) ? formatCompactTokens(usage[field]) : "—";
}

export function formatUsageCompact(usage?: UsageSnapshot): string {
	if (!usage) return "tok —";
	return `Σ${formatUsageField(usage, "totalTokens")} ↑${formatUsageField(usage, "input")} ↓${formatUsageField(usage, "output")} R${formatUsageField(usage, "cacheRead")} W${formatUsageField(usage, "cacheWrite")}`;
}

function formatBilling(mode: BillingMode, usage?: UsageSnapshot, showCost = true): string | undefined {
	if (mode === "subscription") return "sub";
	if (mode === "mixed") {
		if (!showCost || !usage?.cost) return "mixed";
		const cost = `$${usage.cost.total.toFixed(usage.cost.total < 0.01 ? 4 : 3)}`;
		return `${cost} + sub`;
	}
	if (showCost && usage?.cost) return `$${usage.cost.total.toFixed(usage.cost.total < 0.01 ? 4 : 3)}`;
	return undefined;
}

function usageDetailField(usage: UsageSnapshot, field: keyof UsageFieldPresence): string {
	return usageFieldReported(usage, field) ? integerFormat.format(usage[field]) : "—";
}

function usageDetails(usage: UsageSnapshot, showCost = true): string[] {
	const lines = [
		`Total:       ${usageDetailField(usage, "totalTokens")}`,
		`Input:       ${usageDetailField(usage, "input")}`,
		`Output:      ${usageDetailField(usage, "output")}`,
		`Cache read:  ${usageDetailField(usage, "cacheRead")}`,
		`Cache write: ${usageDetailField(usage, "cacheWrite")}`,
	];
	if (showCost && usage.cost) lines.push(`Cost:        $${usage.cost.total.toFixed(4)}`);
	return lines;
}

function wrapSegments(value: string, width: number): string[] {
	const safeWidth = Math.max(1, width);
	const segments = value.split(" · ");
	const lines: string[] = [];
	let current = segments.shift() ?? "";
	for (const segment of segments) {
		const candidate = `${current} · ${segment}`;
		if (candidate.length <= safeWidth) {
			current = candidate;
			continue;
		}
		lines.push(current.slice(0, safeWidth));
		current = `  ${segment}`;
	}
	if (current) lines.push(current.slice(0, safeWidth));
	return lines;
}

function wrapWords(value: string, width: number): string[] {
	const safeWidth = Math.max(1, width);
	const indent = safeWidth > 2 ? "  " : "";
	const lines: string[] = [];
	let current = indent;
	for (const word of value.split(/\s+/)) {
		const candidate = current === indent ? `${indent}${word}` : `${current} ${word}`;
		if (candidate.length <= safeWidth) {
			current = candidate;
			continue;
		}
		if (current !== indent) lines.push(current);
		current = `${indent}${word}`.slice(0, safeWidth);
	}
	if (current !== indent) lines.push(current);
	return lines;
}

function formatCount(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function compactWithUsage(
	prefix: string,
	usage: UsageSnapshot | undefined,
	billing: BillingMode,
	width: number,
	showCost = true,
): string[] {
	const usageText = formatUsageCompact(usage);
	const billingText = formatBilling(billing, usage, showCost);
	const suffix = billingText ? `${usageText} · ${billingText}` : usageText;
	const joined = `${prefix} · ${suffix}`;
	if (joined.length <= width) return [joined];
	const lines = wrapSegments(prefix, width);
	const lastIndex = lines.length - 1;
	const combined = `${lines[lastIndex]} · ${suffix}`;
	if (combined.length <= width) lines[lastIndex] = combined;
	else lines.push(...wrapWords(suffix, width));
	return lines;
}

function aggregateToolUsage(tools: ToolTimingRecord[]): {
	usage: UsageSnapshot | undefined;
	billingMode: BillingMode;
} {
	let usage: UsageSnapshot | undefined;
	let billingMode: BillingMode = "unknown";
	for (const tool of tools) {
		if (!tool.usage) continue;
		usage = addUsageByBilling(usage, billingMode, tool.usage, tool.billingMode);
		billingMode = mergeBilling(billingMode, tool.billingMode);
	}
	return { usage, billingMode };
}

export interface TimingDisplayOptions {
	showCost?: boolean;
	showMilliseconds?: boolean;
}

export function formatTimingRecord(
	record: TimingRecord,
	expanded = false,
	width = 160,
	display: TimingDisplayOptions = {},
): string[] {
	const showCost = display.showCost ?? true;
	const timestamp = (value: number) => formatTimestamp(value, display.showMilliseconds ?? true);
	if (record.kind === "user") return [`└ sent ${timestamp(record.submittedAt)}`.slice(0, width)];

	if (record.kind === "assistant") {
		const state = record.stopReason === "aborted" ? " · aborted" : record.stopReason === "error" ? " · failed" : "";
		const timing = [
			`${timestamp(record.startedAt)}–${timestamp(record.endedAt)}`,
			formatDuration(record.durationMs),
			record.ttftMs === undefined ? undefined : `TTFT ${formatDuration(record.ttftMs)}`,
			record.outputTokensPerSecond === undefined ? undefined : `${record.outputTokensPerSecond.toFixed(1)} tok/s`,
		]
			.filter(Boolean)
			.join(" · ");
		const compact = compactWithUsage(`└ ${timing}${state}`, record.usage, record.billingMode, width, showCost);
		if (!expanded) return compact;
		const details = [
			`Start:       ${timestamp(record.startedAt)}`,
			`First token: ${record.ttftMs === undefined ? "—" : formatDuration(record.ttftMs)}`,
			`End:         ${timestamp(record.endedAt)}`,
			`Duration:    ${formatDuration(record.durationMs)}`,
			`Streaming:   ${record.streamingMs === undefined ? "—" : formatDuration(record.streamingMs)}`,
			...(record.usage ? usageDetails(record.usage, showCost && record.billingMode === "metered") : ["Tokens:      —"]),
		];
		if (record.provider || record.model)
			details.push(`Model:       ${[record.provider, record.model].filter(Boolean).join("/")}`);
		if (record.stopReason) details.push(`Stop reason: ${record.stopReason}`);
		return [...compact, ...details.map((line) => `  ${line}`.slice(0, width))];
	}

	if (record.kind === "tool") {
		const status = record.status === "success" ? "" : ` · ${record.status === "error" ? "failed" : "aborted"}`;
		const prefix = `└ ${record.toolName} · ${timestamp(record.startedAt)}–${timestamp(record.endedAt)} · ${formatDuration(record.durationMs)}${status}`;
		const compact = record.usage
			? compactWithUsage(prefix, record.usage, record.billingMode, width, showCost)
			: wrapSegments(prefix, width);
		if (!expanded) return compact;
		return [
			...compact,
			`  Tool call: ${record.toolCallId}`.slice(0, width),
			...(record.usage
				? usageDetails(record.usage, showCost && record.billingMode === "metered").map((line) =>
						`  ${line}`.slice(0, width),
					)
				: []),
		];
	}

	if (record.kind === "batch") {
		const status = record.status === "success" ? "" : ` · ${record.status === "error" ? "failed" : "aborted"}`;
		const prefix = `◆ Batch · ${formatCount(record.tools.length, "tool")} · wall ${formatDuration(record.wallMs)} · work ${formatDuration(record.workMs)}${status}`;
		const aggregate = aggregateToolUsage(record.tools);
		const lines = aggregate.usage
			? compactWithUsage(prefix, aggregate.usage, aggregate.billingMode, width, showCost)
			: wrapSegments(prefix, width);
		for (const [index, tool] of record.tools.entries()) {
			const outcome = tool.status === "success" ? "" : ` · ${tool.status === "error" ? "failed" : "aborted"}`;
			lines.push(
				...wrapSegments(`  ${index + 1}. ${tool.toolName} · ${formatDuration(tool.durationMs)}${outcome}`, width),
			);
			if (expanded) {
				const details = `     ${tool.toolCallId} · ${timestamp(tool.startedAt)}–${timestamp(tool.endedAt)}`;
				lines.push(
					...(tool.usage
						? compactWithUsage(details, tool.usage, tool.billingMode, width, showCost)
						: wrapSegments(details, width)),
				);
			}
		}
		return lines;
	}

	const title = record.status === "aborted" ? "◆ Aborted" : record.status === "failed" ? "◆ Failed" : "◆ Total";
	const prefix = `${title} · ${timestamp(record.startedAt)}–${timestamp(record.endedAt)} · ${formatDuration(record.durationMs)} · ${formatCount(record.assistantSteps, "step")} · ${formatCount(record.toolCalls, "tool")}`;
	const compact = compactWithUsage(prefix, record.totalUsage, record.billingMode, width, showCost);
	if (!expanded) return compact;
	const details = [
		`Model time: ${formatDuration(record.assistantDurationMs)}`,
		`Tool wall:  ${formatDuration(record.toolWallMs)}`,
		`Tool work:  ${formatDuration(record.toolWorkMs)}`,
		`Failures:   ${record.toolFailures}`,
		`Aborted:    ${record.toolAborts}`,
	];
	if (record.userWaitMs > 0) details.push(`User wait:  ${formatDuration(record.userWaitMs)}`);
	if (record.retryWaitMs > 0) details.push(`Retry wait: ${formatDuration(record.retryWaitMs)}`);
	return [...compact, ...details.map((line) => `  ${line}`.slice(0, width))];
}

export function formatLiveSnapshot(snapshot: LiveSnapshot): string {
	const prefix = `${formatDuration(snapshot.elapsedMs)}`;
	if (snapshot.phase === "waiting") return `${prefix} · waiting for input`;
	if (snapshot.activeTools.length === 1) {
		const tool = snapshot.activeTools[0]!;
		return `${prefix} · ${tool.toolName} ${formatDuration(tool.elapsedMs)}`;
	}
	if (snapshot.activeTools.length > 1) return `${prefix} · ${snapshot.activeTools.length} tools`;
	if (snapshot.phase === "assistant") {
		const streamingUsage = snapshot.streamingUsage;
		const output = streamingUsage && usageFieldReported(streamingUsage, "output") ? streamingUsage.output : undefined;
		return output === undefined ? `${prefix} · assistant` : `${prefix} · assistant · ↓${formatCompactTokens(output)}`;
	}
	return prefix;
}

export function coerceTimingRecord(value: unknown): TimingRecord | undefined {
	if (!value || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	if (!["user", "assistant", "tool", "batch", "cycle"].includes(String(record.kind))) return undefined;
	if (record.schemaVersion === TIMING_SCHEMA_VERSION) return value as TimingRecord;
	const startedAt = safeWall(record.startedAt, safeWall(record.submittedAt, 0));
	const base = {
		schemaVersion: TIMING_SCHEMA_VERSION,
		sourceSchemaVersion: 1,
		cycleId: "legacy-v1",
		sequence: 0,
	} as const;
	if (record.kind === "user") return { ...base, kind: "user", submittedAt: safeWall(record.submittedAt, startedAt) };
	if (record.kind === "assistant") {
		const usage = normalizeUsage(record.usage);
		return {
			...base,
			kind: "assistant",
			turnIndex: -1,
			startedAt,
			endedAt: safeWall(record.endedAt, startedAt),
			durationMs: finiteNonNegative(record.durationMs),
			usage,
			provider: typeof record.provider === "string" ? record.provider : undefined,
			model: typeof record.model === "string" ? record.model : undefined,
			billingMode: billingModeFor(record.provider, usage),
			stopReason: typeof record.stopReason === "string" ? record.stopReason : undefined,
		};
	}
	if (record.kind === "tool") {
		const usage = normalizeUsage(record.usage);
		return {
			...base,
			kind: "tool",
			turnIndex: -1,
			toolCallId: String(record.toolCallId ?? "legacy"),
			toolName: String(record.toolName ?? "tool"),
			startedAt,
			endedAt: safeWall(record.endedAt, startedAt),
			durationMs: finiteNonNegative(record.durationMs),
			usage,
			billingMode: billingModeFor(undefined, usage),
			status: record.status === "error" || record.status === "aborted" ? record.status : "success",
		};
	}
	if (record.kind === "cycle") {
		const totalUsage = normalizeUsage(record.totalUsage);
		return {
			...base,
			kind: "cycle",
			startedAt,
			endedAt: safeWall(record.endedAt, startedAt),
			durationMs: finiteNonNegative(record.durationMs),
			assistantDurationMs: finiteNonNegative(record.assistantDurationMs),
			toolWallMs: finiteNonNegative(record.toolWallMs),
			toolWorkMs: finiteNonNegative(record.toolWorkMs),
			assistantSteps: finiteNonNegative(record.assistantSteps),
			toolCalls: finiteNonNegative(record.toolCalls),
			toolFailures: finiteNonNegative(record.toolFailures),
			toolAborts: finiteNonNegative(record.toolAborts),
			submissions: finiteNonNegative(record.submissions),
			userWaitMs: finiteNonNegative(record.userWaitMs),
			retryWaitMs: finiteNonNegative(record.retryWaitMs),
			assistantUsage: normalizeUsage(record.assistantUsage),
			toolUsage: normalizeUsage(record.toolUsage),
			totalUsage,
			billingMode: billingModeFor(undefined, totalUsage),
			status: record.status === "failed" || record.status === "aborted" ? record.status : "success",
		};
	}
	return undefined;
}
