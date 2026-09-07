import {
	type AssistantTimingRecord,
	addUsage,
	type BatchTimingRecord,
	type CycleTimingRecord,
	coerceTimingRecord,
	formatCompactTokens,
	formatDuration,
	formatTimestamp,
	formatUsageCompact,
	type TimingRecord,
	type ToolTimingRecord,
	type UsageSnapshot,
} from "./core.ts";

export interface TimingSummary {
	cycles: number;
	assistantSteps: number;
	tools: number;
	elapsedMs: number;
	assistantMs: number;
	toolWallMs: number;
	toolWorkMs: number;
	userWaitMs: number;
	retryWaitMs: number;
	usage?: UsageSnapshot;
	cost?: number;
	billing: "metered" | "subscription" | "mixed" | "unknown";
	ttftMedianMs?: number;
	ttftP95Ms?: number;
	outputMedianTokensPerSecond?: number;
	slowestTool?: { name: string; durationMs: number };
	failures: number;
	aborted: number;
}

export function timingRecordsFromEntries(entries: readonly unknown[]): TimingRecord[] {
	const records: TimingRecord[] = [];
	for (const value of entries) {
		if (!value || typeof value !== "object") continue;
		const entry = value as Record<string, unknown>;
		if (entry.type !== "custom" || entry.customType !== "message-timing") continue;
		const record = coerceTimingRecord(entry.data);
		if (record) records.push(record);
	}
	return records;
}

export function toolsFromRecords(records: readonly TimingRecord[]): ToolTimingRecord[] {
	const tools: ToolTimingRecord[] = [];
	for (const record of records) {
		if (record.kind === "tool") tools.push(record);
		else if (record.kind === "batch") tools.push(...record.tools);
	}
	return tools;
}

function percentile(values: number[], ratio: number): number | undefined {
	if (values.length === 0) return undefined;
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
	return sorted[index];
}

export function summarizeTiming(records: readonly TimingRecord[]): TimingSummary {
	const cycles = records.filter((record): record is CycleTimingRecord => record.kind === "cycle");
	const v2Cycles = cycles.filter((record) => record.sourceSchemaVersion !== 1);
	const assistants = records.filter((record): record is AssistantTimingRecord => record.kind === "assistant");
	const coveredCycleIds = new Set(v2Cycles.map((record) => record.cycleId));
	const uncoveredAssistants = assistants.filter(
		(record) => record.sourceSchemaVersion === 1 || !coveredCycleIds.has(record.cycleId),
	);
	const tools = toolsFromRecords(records);
	const uncoveredTools = tools.filter(
		(record) => record.sourceSchemaVersion === 1 || !coveredCycleIds.has(record.cycleId),
	);
	let usage: UsageSnapshot | undefined;
	const completedCycleIds = new Set(cycles.map((record) => record.cycleId));
	for (const cycle of cycles) usage = addUsage(usage, cycle.totalUsage);
	for (const assistant of assistants) {
		if (!completedCycleIds.has(assistant.cycleId)) usage = addUsage(usage, assistant.usage);
	}
	for (const tool of tools) {
		if (!completedCycleIds.has(tool.cycleId)) usage = addUsage(usage, tool.usage);
	}
	const ttft = assistants.flatMap((record) => (record.ttftMs === undefined ? [] : [record.ttftMs]));
	const speeds = assistants.flatMap((record) =>
		record.outputTokensPerSecond === undefined ? [] : [record.outputTokensPerSecond],
	);
	const slowestTool = tools.reduce<ToolTimingRecord | undefined>(
		(best, tool) => (!best || tool.durationMs > best.durationMs ? tool : best),
		undefined,
	);
	const billedRecords = [
		...cycles.map((record) => record.billingMode),
		...uncoveredAssistants.map((record) => record.billingMode),
		...uncoveredTools.map((record) => record.billingMode),
	];
	const hasMetered = billedRecords.includes("metered");
	const hasSubscription = billedRecords.includes("subscription");
	const billing =
		hasMetered && hasSubscription ? "mixed" : hasMetered ? "metered" : hasSubscription ? "subscription" : "unknown";
	return {
		cycles: cycles.length,
		assistantSteps: assistants.length,
		tools: tools.length,
		elapsedMs: cycles.reduce((sum, cycle) => sum + cycle.durationMs, 0),
		assistantMs:
			v2Cycles.reduce((sum, cycle) => sum + cycle.assistantDurationMs, 0) +
			uncoveredAssistants.reduce((sum, assistant) => sum + assistant.durationMs, 0),
		toolWallMs:
			v2Cycles.reduce((sum, cycle) => sum + cycle.toolWallMs, 0) +
			uncoveredTools.reduce((sum, tool) => sum + tool.durationMs, 0),
		toolWorkMs:
			v2Cycles.reduce((sum, cycle) => sum + cycle.toolWorkMs, 0) +
			uncoveredTools.reduce((sum, tool) => sum + tool.durationMs, 0),
		userWaitMs: cycles.reduce((sum, cycle) => sum + cycle.userWaitMs, 0),
		retryWaitMs: cycles.reduce((sum, cycle) => sum + cycle.retryWaitMs, 0),
		usage,
		cost: billing === "metered" ? usage?.cost?.total : undefined,
		billing,
		ttftMedianMs: percentile(ttft, 0.5),
		ttftP95Ms: percentile(ttft, 0.95),
		outputMedianTokensPerSecond: percentile(speeds, 0.5),
		slowestTool: slowestTool ? { name: slowestTool.toolName, durationMs: slowestTool.durationMs } : undefined,
		failures: tools.filter((tool) => tool.status === "error").length,
		aborted: tools.filter((tool) => tool.status === "aborted").length,
	};
}

function metric(label: string, value: string): string {
	return `${label.padEnd(24)}${value.padStart(12)}`;
}

function formatCount(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function formatSummary(summary: TimingSummary): string[] {
	const lines = [
		"Timing · current branch",
		"",
		`${formatCount(summary.cycles, "cycle")} · ${formatCount(summary.assistantSteps, "model step")} · ${formatCount(summary.tools, "tool")}`,
		metric("Elapsed", formatDuration(summary.elapsedMs)),
		metric("Model, cumulative", formatDuration(summary.assistantMs)),
		metric("Tool wall time", formatDuration(summary.toolWallMs)),
		metric("Tool work, cumulative", formatDuration(summary.toolWorkMs)),
		metric("Waiting for user", formatDuration(summary.userWaitMs)),
		metric("Retry wait", formatDuration(summary.retryWaitMs)),
	];
	if (summary.usage) {
		lines.push(
			"",
			metric("Tokens", `Σ${formatCompactTokens(summary.usage.totalTokens)}`),
			metric("  Input", formatCompactTokens(summary.usage.input)),
			metric("  Output", formatCompactTokens(summary.usage.output)),
			metric("  Cache read", formatCompactTokens(summary.usage.cacheRead)),
			metric("  Cache write", formatCompactTokens(summary.usage.cacheWrite)),
		);
	}
	if (summary.billing === "subscription") lines.push(metric("Billing", "subscription"));
	else if (summary.billing === "mixed") lines.push(metric("Billing", "mixed"));
	else if (summary.cost !== undefined) lines.push(metric("Cost", `$${summary.cost.toFixed(4)}`));
	if (summary.ttftMedianMs !== undefined) lines.push(metric("TTFT median", formatDuration(summary.ttftMedianMs)));
	if (summary.ttftP95Ms !== undefined) lines.push(metric("TTFT p95", formatDuration(summary.ttftP95Ms)));
	if (summary.outputMedianTokensPerSecond !== undefined) {
		lines.push(metric("Output median", `${summary.outputMedianTokensPerSecond.toFixed(1)} tok/s`));
	}
	if (summary.slowestTool)
		lines.push(
			metric("Slowest tool", `${summary.slowestTool.name} · ${formatDuration(summary.slowestTool.durationMs)}`),
		);
	lines.push(metric("Failures", String(summary.failures)), metric("Aborted", String(summary.aborted)));
	return lines;
}

export function formatTimeline(records: readonly TimingRecord[]): string[] {
	const lines = ["Timing timeline · current branch", ""];
	for (const record of records) {
		if (record.kind === "assistant") {
			lines.push(
				`${formatTimestamp(record.startedAt)}  model  ${formatDuration(record.durationMs)}  ${formatUsageCompact(record.usage)}`,
			);
		} else if (record.kind === "tool") {
			lines.push(
				`${formatTimestamp(record.startedAt)}  tool   ${record.toolName}  ${formatDuration(record.durationMs)}  ${record.status}`,
			);
		} else if (record.kind === "batch") {
			lines.push(
				`${formatTimestamp(record.startedAt)}  batch  ${formatCount(record.tools.length, "tool")}  wall ${formatDuration(record.wallMs)}  work ${formatDuration(record.workMs)}`,
			);
			for (const tool of record.tools)
				lines.push(`              └ ${tool.toolName}  ${formatDuration(tool.durationMs)}  ${tool.status}`);
		} else if (record.kind === "cycle") {
			lines.push(`${formatTimestamp(record.endedAt)}  cycle  ${formatDuration(record.durationMs)}  ${record.status}`);
		}
	}
	if (lines.length === 2) lines.push("No timing records on the current branch.");
	return lines;
}

function safeUsage(usage: UsageSnapshot | undefined): Record<string, unknown> | undefined {
	if (!usage) return undefined;
	const field = (name: "input" | "output" | "cacheRead" | "cacheWrite" | "totalTokens") =>
		usage.reported?.[name] === false ? undefined : usage[name];
	return {
		input: field("input"),
		output: field("output"),
		cacheRead: field("cacheRead"),
		cacheWrite: field("cacheWrite"),
		totalTokens: field("totalTokens"),
		cost: usage.cost ? { total: usage.cost.total } : undefined,
	};
}

function safeBase(record: TimingRecord): Record<string, unknown> {
	return {
		schemaVersion: record.schemaVersion,
		sourceSchemaVersion: record.sourceSchemaVersion,
		cycleId: record.cycleId,
		sequence: record.sequence,
		kind: record.kind,
	};
}

function safeExportRecord(record: TimingRecord): Record<string, unknown> {
	const base = safeBase(record);
	if (record.kind === "user") return { ...base, submittedAt: record.submittedAt };
	if (record.kind === "assistant")
		return {
			...base,
			turnIndex: record.turnIndex,
			startedAt: record.startedAt,
			endedAt: record.endedAt,
			durationMs: record.durationMs,
			ttftMs: record.ttftMs,
			streamingMs: record.streamingMs,
			outputTokensPerSecond: record.outputTokensPerSecond,
			usage: safeUsage(record.usage),
			provider: record.provider,
			model: record.model,
			billingMode: record.billingMode,
			stopReason: record.stopReason,
		};
	if (record.kind === "tool")
		return {
			...base,
			turnIndex: record.turnIndex,
			toolCallId: record.toolCallId,
			toolName: record.toolName,
			startedAt: record.startedAt,
			endedAt: record.endedAt,
			durationMs: record.durationMs,
			usage: safeUsage(record.usage),
			billingMode: record.billingMode,
			status: record.status,
		};
	if (record.kind === "batch")
		return {
			...base,
			turnIndex: record.turnIndex,
			batchId: record.batchId,
			startedAt: record.startedAt,
			endedAt: record.endedAt,
			wallMs: record.wallMs,
			workMs: record.workMs,
			status: record.status,
			tools: record.tools.map((tool) => safeExportRecord(tool)),
		};
	return {
		...base,
		startedAt: record.startedAt,
		endedAt: record.endedAt,
		durationMs: record.durationMs,
		assistantDurationMs: record.assistantDurationMs,
		toolWallMs: record.toolWallMs,
		toolWorkMs: record.toolWorkMs,
		assistantSteps: record.assistantSteps,
		toolCalls: record.toolCalls,
		toolFailures: record.toolFailures,
		toolAborts: record.toolAborts,
		submissions: record.submissions,
		userWaitMs: record.userWaitMs,
		retryWaitMs: record.retryWaitMs,
		assistantUsage: safeUsage(record.assistantUsage),
		toolUsage: safeUsage(record.toolUsage),
		totalUsage: safeUsage(record.totalUsage),
		billingMode: record.billingMode,
		status: record.status,
	};
}

export function exportTimingJson(records: readonly TimingRecord[]): string {
	return `${JSON.stringify({ schemaVersion: 1, scope: "current-branch", records: records.map(safeExportRecord) }, null, 2)}\n`;
}

function csvCell(value: unknown): string {
	const text = value === undefined ? "" : String(value);
	return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function exportTimingCsv(records: readonly TimingRecord[]): string {
	const header = [
		"schemaVersion",
		"cycleId",
		"sequence",
		"kind",
		"turnIndex",
		"batchId",
		"toolCallId",
		"toolName",
		"startedAt",
		"endedAt",
		"durationMs",
		"wallMs",
		"workMs",
		"status",
		"input",
		"output",
		"cacheRead",
		"cacheWrite",
		"totalTokens",
		"cost",
	];
	const rows: unknown[][] = [header];
	const add = (record: TimingRecord, batchId?: string) => {
		const usage = record.kind === "cycle" ? record.totalUsage : "usage" in record ? record.usage : undefined;
		rows.push([
			record.schemaVersion,
			record.cycleId,
			record.sequence,
			record.kind,
			"turnIndex" in record ? record.turnIndex : "",
			batchId ?? (record.kind === "batch" ? record.batchId : ""),
			record.kind === "tool" ? record.toolCallId : "",
			record.kind === "tool" ? record.toolName : "",
			"startedAt" in record ? record.startedAt : record.submittedAt,
			"endedAt" in record ? record.endedAt : "",
			"durationMs" in record ? record.durationMs : "",
			record.kind === "batch" ? record.wallMs : "",
			record.kind === "batch" ? record.workMs : "",
			"status" in record ? record.status : "",
			usage?.reported?.input === false ? undefined : usage?.input,
			usage?.reported?.output === false ? undefined : usage?.output,
			usage?.reported?.cacheRead === false ? undefined : usage?.cacheRead,
			usage?.reported?.cacheWrite === false ? undefined : usage?.cacheWrite,
			usage?.reported?.totalTokens === false ? undefined : usage?.totalTokens,
			usage?.cost?.total,
		]);
	};
	for (const record of records) {
		add(record);
		if (record.kind === "batch") for (const tool of record.tools) add(tool, record.batchId);
	}
	return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

export type { BatchTimingRecord };
