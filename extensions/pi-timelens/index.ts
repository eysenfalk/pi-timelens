import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, Text } from "@earendil-works/pi-tui";
import { registerTimingCommands } from "./commands.ts";
import { registerMessageTiming, type TimingPi } from "./runtime.ts";
import { DEFAULT_TIMING_SETTINGS, normalizeSettings, type TimingSettings } from "./settings.ts";

function agentDirectory(): string {
	return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function loadSettings(path: string): TimingSettings {
	try {
		return normalizeSettings(JSON.parse(readFileSync(path, "utf8")));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			console.error(`[message-timing] Could not load ${path}:`, error);
		}
		return { ...DEFAULT_TIMING_SETTINGS };
	}
}

function writeAtomic(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.tmp-${process.pid}`;
	writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
	renameSync(temporary, path);
}

export default function messageTiming(pi: ExtensionAPI): void {
	const root = agentDirectory();
	const settingsPath = join(root, "message-timing.json");
	let settings = loadSettings(settingsPath);
	registerMessageTiming(pi as unknown as TimingPi, {}, { getSettings: () => settings });
	registerTimingCommands(pi as never, {
		getSettings: () => settings,
		saveSettings(next) {
			settings = next;
			writeAtomic(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
		},
		async showPanel(ctx, _title, lines) {
			const ui = (ctx as any).ui;
			if ((ctx as any).mode !== "tui" || typeof ui.custom !== "function") {
				ui.notify(lines.join("\n"), "info");
				return;
			}
			await ui.custom((tui: any, theme: any, _keybindings: any, done: () => void) => {
				const text = new Text(lines.map((line) => theme.fg("dim", line)).join("\n"), 1, 1);
				return {
					render: (width: number) => text.render(width),
					invalidate: () => text.invalidate(),
					handleInput(data: string) {
						if (matchesKey(data, "escape") || matchesKey(data, "enter")) done();
						tui.requestRender();
					},
				};
			});
		},
		writeExport(format, content) {
			const stamp = new Date().toISOString().replaceAll(":", "-");
			const path = join(root, "state", "private", "message-timing-exports", `timing-${stamp}.${format}`);
			writeAtomic(path, content);
			return path;
		},
	});
}
