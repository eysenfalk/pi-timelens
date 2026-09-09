import {
	type AssistantTimingRecord,
	addUsageByBilling,
	type BatchTimingRecord,
	type BillingMode,
	type CycleTimingRecord,
	coerceTimingRecord,
	formatCompactTokens,
	formatDuration,
	formatTimestamp,
	formatUsageCompact,
	mergeBilling,
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
	thinkingMs?: number;
	reasoningTokens?: number;
	usage?: UsageSnapshot;
	cost?: number;
	billing: "metered" | "subscription" | "mixed" | "unknown";
	responseMedianMs?: number;
	responseP95Ms?: number;
	ttftMedianMs?: number;
	ttftP95Ms?: number;
	outputMedianTokensPerSecond?: number;
	slowestTool?: { name: string; durationMs: number };
	failures: number;
	aborted: number;
}

export function timingRecordsFromEntries(entries: readonly unknown[]): TimingRecord[] {
	const records: TimingRecord[] = [];
	let legacyCycleIndex = 0;
	for (const value of entries) {
		if (!value || typeof value !== "object") continue;
		const entry = value as Record<string, unknown>;
		if (entry.type !== "custom" || entry.customType !== "message-timing") continue;
		const record = coerceTimingRecord(entry.data);
		if (!record) continue;
		if (record.sourceSchemaVersion !== 1) {
			records.push(record);
			continue;
		}
		const legacy = { ...record, cycleId: `legacy-v1-${legacyCycleIndex}` } as TimingRecord;
		records.push(legacy);
		if (legacy.kind === "cycle") legacyCycleIndex += 1;
	}
	return records;
}

export function toolsFromRecords(records: readonly TimingRecord[]): ToolTimingRecord[] {
	const tools: ToolTimingRecord[] = [];
	for (const record of records) {
		if (record.kind === "tool") tools.push(record);
		else if (record.kind === "batch" || record.kind === "step") tools.push(...record.tools);
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
	const assistants = records.flatMap((record): AssistantTimingRecord[] => {
		if (record.kind === "assistant") return [record];
		if (record.kind === "step" && record.assistant) return [record.assistant];
		return [];
	});
	const coveredCycleIds = new Set(v2Cycles.map((record) => record.cycleId));
	const uncoveredAssistants = assistants.filter(
		(record) => record.sourceSchemaVersion === 1 || !coveredCycleIds.has(record.cycleId),
	);
	const tools = toolsFromRecords(records);
	const uncoveredTools = tools.filter(
		(record) => record.sourceSchemaVersion === 1 || !coveredCycleIds.has(record.cycleId),
	);
	const completedCycleIds = new Set(
		cycles.filter((record) => record.totalUsage !== undefined).map((record) => record.cycleId),
	);
	const usageSources = [
		...cycles.map((record) => ({ usage: record.totalUsage, billingMode: record.billingMode })),
		...assistants
			.filter((record) => !completedCycleIds.has(record.cycleId))
			.map((record) => ({ usage: record.usage, billingMode: record.billingMode })),
		...tools
			.filter((record) => !completedCycleIds.has(record.cycleId))
			.map((record) => ({ usage: record.usage, billingMode: record.billingMode })),
	];
	let usage: UsageSnapshot | undefined;
	let billing: BillingMode = "unknown";
	for (const source of usageSources) {
		usage = addUsageByBilling(usage, billing, source.usage, source.billingMode);
		billing = mergeBilling(billing, source.billingMode);
	}
	const response = assistants.flatMap((record) => (record.responseMs === undefined ? [] : [record.responseMs]));
	const ttft = assistants.flatMap((record) => (record.textTtftMs === undefined ? [] : [record.textTtftMs]));
	const thinkingMs =
		assistants.length > 0 && assistants.every((record) => record.thinkingMs !== undefined)
			? assistants.reduce((sum, record) => sum + (record.thinkingMs ?? 0), 0)
			: undefined;
	const reasoningSources = [
		...cycles.flatMap((record) => (record.totalUsage === undefined ? [] : [record.totalUsage])),
		...assistants.filter((record) => !completedCycleIds.has(record.cycleId)).map((record) => record.usage),
		...tools
			.filter((record) => !completedCycleIds.has(record.cycleId) && record.usage !== undefined)
			.map((record) => record.usage),
	];
	const reasoningTokens =
		reasoningSources.length > 0 && reasoningSources.every((source) => source?.reasoning !== undefined)
			? usage?.reasoning
			: undefined;
	const speeds = assistants.flatMap((record) =>
		record.outputTokensPerSecond === undefined ? [] : [record.outputTokensPerSecond],
	);
	const slowestTool = tools.reduce<ToolTimingRecord | undefined>(
		(best, tool) => (!best || tool.durationMs > best.durationMs ? tool : best),
		undefined,
	);
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
		thinkingMs,
		reasoningTokens,
		usage,
		cost: billing === "metered" || billing === "mixed" ? usage?.cost?.total : undefined,
		billing,
		responseMedianMs: percentile(response, 0.5),
		responseP95Ms: percentile(response, 0.95),
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

export function formatSummary(summary: TimingSummary, display: { showCost?: boolean } = {}): string[] {
	const showCost = display.showCost ?? true;
	const lines = [
		"Timing · current branch",
		"",
		`${formatCount(summary.cycles, "cycle")} · ${formatCount(summary.assistantSteps, "model step")} · ${formatCount(summary.tools, "tool")}`,
		metric("Elapsed", formatDuration(summary.elapsedMs)),
		metric("Model, cumulative", formatDuration(summary.assistantMs)),
		...(summary.thinkingMs === undefined ? [] : [metric("Thinking phase", formatDuration(summary.thinkingMs))]),
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
			...(summary.reasoningTokens === undefined
				? []
				: [metric("  Reasoning", formatCompactTokens(summary.reasoningTokens))]),
			metric("  Cache read", formatCompactTokens(summary.usage.cacheRead)),
			metric("  Cache write", formatCompactTokens(summary.usage.cacheWrite)),
		);
	}
	if (summary.billing === "subscription") lines.push(metric("Billing", "subscription"));
	else if (summary.billing === "mixed") {
		lines.push(metric("Billing", "mixed"));
		if (showCost && summary.cost !== undefined) lines.push(metric("Metered cost", `$${summary.cost.toFixed(4)}`));
	} else if (showCost && summary.cost !== undefined) lines.push(metric("Cost", `$${summary.cost.toFixed(4)}`));
	if (summary.responseMedianMs !== undefined) {
		lines.push(metric("Response median", formatDuration(summary.responseMedianMs)));
	}
	if (summary.responseP95Ms !== undefined) lines.push(metric("Response p95", formatDuration(summary.responseP95Ms)));
	if (summary.ttftMedianMs !== undefined) lines.push(metric("Text TTFT median", formatDuration(summary.ttftMedianMs)));
	if (summary.ttftP95Ms !== undefined) lines.push(metric("Text TTFT p95", formatDuration(summary.ttftP95Ms)));
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
		} else if (record.kind === "step") {
			lines.push(`${formatTimestamp(record.startedAt)}  step   ${formatDuration(record.durationMs)}  ${record.status}`);
			if (record.assistant) {
				const modelSegments = [
					`              └ model  ${formatDuration(record.assistant.durationMs)}`,
					record.assistant.responseMs === undefined
						? undefined
						: `response ${formatDuration(record.assistant.responseMs)}`,
					record.assistant.textTtftMs === undefined ? undefined : `ttft ${formatDuration(record.assistant.textTtftMs)}`,
					record.assistant.thinkingMs === undefined
						? undefined
						: `think ${formatDuration(record.assistant.thinkingMs)}`,
					formatUsageCompact(record.assistant.usage),
				];
				lines.push(modelSegments.filter(Boolean).join("  "));
			}
			for (const tool of record.tools) {
				lines.push(`              └ ${tool.toolName}  ${formatDuration(tool.durationMs)}  ${tool.status}`);
			}
		} else if (record.kind === "cycle") {
			lines.push(`${formatTimestamp(record.endedAt)}  cycle  ${formatDuration(record.durationMs)}  ${record.status}`);
		}
	}
	if (lines.length === 2) lines.push("No timing records on the current branch.");
	return lines;
}

function safeUsage(usage: UsageSnapshot | undefined, billingMode: BillingMode): Record<string, unknown> | undefined {
	if (!usage) return undefined;
	const field = (name: "input" | "output" | "cacheRead" | "cacheWrite" | "totalTokens") =>
		usage.reported?.[name] === false ? undefined : usage[name];
	return {
		input: field("input"),
		output: field("output"),
		cacheRead: field("cacheRead"),
		cacheWrite: field("cacheWrite"),
		totalTokens: field("totalTokens"),
		reasoning: usage.reasoning,
		cost: billingMode === "subscription" || !usage.cost ? undefined : { total: usage.cost.total },
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
			responseMs: record.responseMs,
			textTtftMs: record.textTtftMs,
			thinkingMs: record.thinkingMs,
			streamingMs: record.streamingMs,
			outputTokensPerSecond: record.outputTokensPerSecond,
			usage: safeUsage(record.usage, record.billingMode),
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
			usage: safeUsage(record.usage, record.billingMode),
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
	if (record.kind === "step")
		return {
			...base,
			turnIndex: record.turnIndex,
			startedAt: record.startedAt,
			endedAt: record.endedAt,
			durationMs: record.durationMs,
			assistant: record.assistant ? safeExportRecord(record.assistant) : undefined,
			toolWallMs: record.toolWallMs,
			toolWorkMs: record.toolWorkMs,
			tools: record.tools.map((tool) => safeExportRecord(tool)),
			usage: safeUsage(record.usage, record.billingMode),
			billingMode: record.billingMode,
			status: record.status,
		};
	return {
		...base,
		startedAt: record.startedAt,
		endedAt: record.endedAt,
		durationMs: record.durationMs,
		assistantDurationMs: record.assistantDurationMs,
		assistantThinkingMs: record.assistantThinkingMs,
		toolWallMs: record.toolWallMs,
		toolWorkMs: record.toolWorkMs,
		assistantSteps: record.assistantSteps,
		toolCalls: record.toolCalls,
		toolFailures: record.toolFailures,
		toolAborts: record.toolAborts,
		submissions: record.submissions,
		userWaitMs: record.userWaitMs,
		retryWaitMs: record.retryWaitMs,
		assistantUsage: safeUsage(record.assistantUsage, record.billingMode),
		toolUsage: safeUsage(record.toolUsage, record.billingMode),
		totalUsage: safeUsage(record.totalUsage, record.billingMode),
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
		"stepId",
		"parentStepId",
		"batchId",
		"toolCallId",
		"toolName",
		"startedAt",
		"endedAt",
		"durationMs",
		"responseMs",
		"textTtftMs",
		"thinkingMs",
		"wallMs",
		"workMs",
		"status",
		"billingMode",
		"input",
		"output",
		"reasoning",
		"cacheRead",
		"cacheWrite",
		"totalTokens",
		"cost",
	];
	const rows: unknown[][] = [header];
	const add = (record: TimingRecord, batchId?: string, parentStepId?: string) => {
		const usage =
			record.kind === "cycle"
				? record.totalUsage
				: record.kind === "step"
					? record.usage
					: "usage" in record
						? record.usage
						: undefined;
		const stepId = record.kind === "step" ? `${record.cycleId}:turn-${record.turnIndex}` : "";
		const billingMode = "billingMode" in record ? record.billingMode : "unknown";
		const assistant = record.kind === "assistant" ? record : record.kind === "step" ? record.assistant : undefined;
		rows.push([
			record.schemaVersion,
			record.cycleId,
			record.sequence,
			record.kind,
			"turnIndex" in record ? record.turnIndex : "",
			stepId,
			parentStepId ?? "",
			batchId ?? (record.kind === "batch" ? record.batchId : ""),
			record.kind === "tool" ? record.toolCallId : "",
			record.kind === "tool" ? record.toolName : "",
			"startedAt" in record ? record.startedAt : record.submittedAt,
			"endedAt" in record ? record.endedAt : "",
			"durationMs" in record ? record.durationMs : "",
			assistant?.responseMs ?? "",
			assistant?.textTtftMs ?? "",
			record.kind === "cycle" ? (record.assistantThinkingMs ?? "") : (assistant?.thinkingMs ?? ""),
			record.kind === "batch" ? record.wallMs : record.kind === "step" ? record.toolWallMs : "",
			record.kind === "batch" ? record.workMs : record.kind === "step" ? record.toolWorkMs : "",
			"status" in record ? record.status : "",
			billingMode,
			usage?.reported?.input === false ? undefined : usage?.input,
			usage?.reported?.output === false ? undefined : usage?.output,
			usage?.reasoning,
			usage?.reported?.cacheRead === false ? undefined : usage?.cacheRead,
			usage?.reported?.cacheWrite === false ? undefined : usage?.cacheWrite,
			usage?.reported?.totalTokens === false ? undefined : usage?.totalTokens,
			billingMode === "subscription" ? undefined : usage?.cost?.total,
		]);
	};
	for (const record of records) {
		add(record);
		if (record.kind === "batch") for (const tool of record.tools) add(tool, record.batchId);
		if (record.kind === "step") {
			const stepId = `${record.cycleId}:turn-${record.turnIndex}`;
			if (record.assistant) add(record.assistant, undefined, stepId);
			for (const tool of record.tools) add(tool, undefined, stepId);
		}
	}
	return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

export type { BatchTimingRecord };
