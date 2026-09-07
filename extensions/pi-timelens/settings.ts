export interface TimingSettings {
	display: "compact" | "detailed" | "off";
	live: boolean;
	showCost: boolean;
	showMilliseconds: boolean;
}

export const DEFAULT_TIMING_SETTINGS: TimingSettings = {
	display: "compact",
	live: true,
	showCost: true,
	showMilliseconds: true,
};

export function normalizeSettings(value: unknown): TimingSettings {
	if (!value || typeof value !== "object") return { ...DEFAULT_TIMING_SETTINGS };
	const record = value as Record<string, unknown>;
	return {
		display: record.display === "detailed" || record.display === "off" ? record.display : "compact",
		live: typeof record.live === "boolean" ? record.live : true,
		showCost: typeof record.showCost === "boolean" ? record.showCost : true,
		showMilliseconds: typeof record.showMilliseconds === "boolean" ? record.showMilliseconds : true,
	};
}

function parseBoolean(value: string): boolean | undefined {
	if (["on", "true", "yes"].includes(value)) return true;
	if (["off", "false", "no"].includes(value)) return false;
	return undefined;
}

export function updateSetting(
	settings: TimingSettings,
	key: string,
	value: string,
): { settings: TimingSettings; error?: string } {
	const normalizedKey = key.toLowerCase();
	const normalizedValue = value.toLowerCase();
	if (normalizedKey === "display") {
		if (!["compact", "detailed", "off"].includes(normalizedValue)) {
			return { settings, error: "Display must be compact, detailed, or off." };
		}
		return { settings: { ...settings, display: normalizedValue as TimingSettings["display"] } };
	}
	const booleanValue = parseBoolean(normalizedValue);
	if (booleanValue === undefined) return { settings, error: "Boolean settings accept on or off." };
	if (normalizedKey === "live") return { settings: { ...settings, live: booleanValue } };
	if (normalizedKey === "cost") return { settings: { ...settings, showCost: booleanValue } };
	if (normalizedKey === "milliseconds") return { settings: { ...settings, showMilliseconds: booleanValue } };
	return { settings, error: `Unknown setting: ${key}` };
}

export function formatSettings(settings: TimingSettings): string[] {
	return [
		"Timing settings",
		"",
		`display       ${settings.display}`,
		`live          ${settings.live ? "on" : "off"}`,
		`cost          ${settings.showCost ? "on" : "off"}`,
		`milliseconds  ${settings.showMilliseconds ? "on" : "off"}`,
		"",
		"Usage: /timing settings <display|live|cost|milliseconds> <value>",
	];
}
