import {
	exportTimingCsv,
	exportTimingJson,
	formatSummary,
	formatTimeline,
	summarizeTiming,
	timingRecordsFromEntries,
} from "./reporting.ts";
import { formatSettings, type TimingSettings, updateSetting } from "./settings.ts";

interface CommandContext {
	sessionManager: { getBranch: () => readonly unknown[] };
	ui: { notify: (message: string, level?: "info" | "warning" | "error") => void };
}

interface CommandPi {
	registerCommand: (
		name: string,
		definition: { description: string; handler: (args: string, ctx: CommandContext) => unknown },
	) => void;
}

export interface TimingCommandDependencies {
	getSettings: () => TimingSettings;
	saveSettings: (settings: TimingSettings) => void;
	showPanel: (ctx: CommandContext, title: string, lines: string[]) => Promise<void> | void;
	writeExport: (format: "json" | "csv", content: string) => string;
}

const LEGEND = [
	"Timing legend",
	"",
	"Step  one model turn and its tools",
	"Total  the complete request cycle",
	"first  time to first provider output",
	"tools  elapsed tool wall time",
	"cached  provider-reported cache-read tokens",
	"cost  provider-reported metered amount when available",
	"",
	"Compact entries omit redundant subscription labels. Expand a timing entry",
	"for billing mode, exact timestamps, model streaming speed, individual tool",
	"durations, cumulative work, and the full token breakdown.",
];

const HELP = [
	"Pi TimeLens",
	"",
	"/timing summary",
	"/timing timeline",
	"/timing legend",
	"/timing settings",
	"/timing settings <display|live|cost|milliseconds> <value>",
	"/timing export <json|csv>",
];

export function registerTimingCommands(pi: CommandPi, dependencies: TimingCommandDependencies): void {
	pi.registerCommand("timing", {
		description: "Show Pi TimeLens summaries, settings, timeline, legend, or safe exports",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const action = parts[0]?.toLowerCase() ?? "help";
			const records = () => timingRecordsFromEntries(ctx.sessionManager.getBranch());
			if (action === "summary") {
				await dependencies.showPanel(
					ctx,
					"Timing summary",
					formatSummary(summarizeTiming(records()), { showCost: dependencies.getSettings().showCost }),
				);
				return;
			}
			if (action === "timeline") {
				await dependencies.showPanel(ctx, "Timing timeline", formatTimeline(records()));
				return;
			}
			if (action === "legend") {
				await dependencies.showPanel(ctx, "Timing legend", LEGEND);
				return;
			}
			if (action === "settings") {
				if (parts.length === 1) {
					await dependencies.showPanel(ctx, "Timing settings", formatSettings(dependencies.getSettings()));
					return;
				}
				if (parts.length !== 3) {
					ctx.ui.notify("Usage: /timing settings <display|live|cost|milliseconds> <value>", "warning");
					return;
				}
				const updated = updateSetting(dependencies.getSettings(), parts[1]!, parts[2]!);
				if (updated.error) {
					ctx.ui.notify(updated.error, "warning");
					return;
				}
				dependencies.saveSettings(updated.settings);
				ctx.ui.notify(`Timing setting updated: ${parts[1]} = ${parts[2]}`, "info");
				return;
			}
			if (action === "export") {
				const format = parts[1]?.toLowerCase();
				if (format !== "json" && format !== "csv") {
					ctx.ui.notify("Usage: /timing export <json|csv>", "warning");
					return;
				}
				const currentRecords = records();
				const content = format === "json" ? exportTimingJson(currentRecords) : exportTimingCsv(currentRecords);
				const path = dependencies.writeExport(format, content);
				ctx.ui.notify(`Timing export written to ${path}`, "info");
				return;
			}
			await dependencies.showPanel(ctx, "Pi TimeLens", HELP);
		},
	});
}
