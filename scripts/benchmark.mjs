import { performance } from "node:perf_hooks";
import { formatTimingRecord, TimingTracker } from "../extensions/pi-timelens/core.ts";

const iterations = 20_000;
const usage = {
	input: 1_500,
	output: 284,
	cacheRead: 8_100,
	cacheWrite: 0,
	totalTokens: 9_884,
	cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
};
const message = { role: "assistant", usage, stopReason: "stop", content: [{ type: "text", text: "ok" }] };

for (let index = 0; index < 2_000; index += 1) run(index);
const startedAt = performance.now();
for (let index = 0; index < iterations; index += 1) run(index);
const elapsedMs = performance.now() - startedAt;
const microsecondsPerCycle = (elapsedMs * 1_000) / iterations;

console.log(JSON.stringify({ node: process.version, iterations, elapsedMs, microsecondsPerCycle }, null, 2));
if (microsecondsPerCycle > 500) {
	console.error(`Performance budget exceeded: ${microsecondsPerCycle.toFixed(2)}µs per synthetic cycle`);
	process.exitCode = 1;
}

function run(index) {
	const tracker = new TimingTracker();
	const base = index * 10;
	const reading = (offset) => ({ wallMs: base + offset, monoMs: base + offset });
	tracker.startSubmission(reading(0));
	tracker.startAgent(reading(0));
	tracker.startTurn(0, reading(0));
	tracker.markFirstOutput(0, reading(1));
	const assistant = tracker.finishAssistant(message, reading(3));
	formatTimingRecord(assistant, false, 120);
	tracker.settle(reading(4));
}
