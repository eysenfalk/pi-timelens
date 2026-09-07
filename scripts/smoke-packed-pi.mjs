import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const cli = resolve(root, "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js");
const temporary = mkdtempSync(join(tmpdir(), "pi-timelens-smoke-"));
const packDirectory = join(temporary, "pack");
const unpackDirectory = join(temporary, "unpacked");
const home = join(temporary, "home");
const agentDirectory = join(home, "agent");
mkdirSync(packDirectory, { recursive: true });
mkdirSync(unpackDirectory, { recursive: true });
mkdirSync(agentDirectory, { recursive: true });

const env = {
	PATH: process.env.PATH,
	HOME: home,
	PI_CODING_AGENT_DIR: agentDirectory,
	PI_OFFLINE: "1",
	XDG_CONFIG_HOME: join(home, "config"),
	XDG_DATA_HOME: join(home, "data"),
	XDG_CACHE_HOME: join(home, "cache"),
	NO_COLOR: "1",
	TERM: "dumb",
};

try {
	const packed = spawnSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", packDirectory], {
		cwd: root,
		encoding: "utf8",
		timeout: 30_000,
	});
	assert.equal(packed.status, 0, packed.stderr || "npm pack failed");
	const packOutput = JSON.parse(packed.stdout);
	const packReport = Array.isArray(packOutput) ? packOutput[0] : Object.values(packOutput)[0];
	assert.ok(packReport && typeof packReport === "object", "npm pack returned no package report");
	const filename = packReport.filename;
	const extracted = spawnSync("tar", ["-xzf", join(packDirectory, filename), "-C", unpackDirectory], {
		encoding: "utf8",
		timeout: 30_000,
	});
	assert.equal(extracted.status, 0, extracted.stderr || "tar extraction failed");
	const packageRoot = join(unpackDirectory, "package");

	const installed = spawnSync(process.execPath, [cli, "install", packageRoot], {
		cwd: home,
		env,
		encoding: "utf8",
		timeout: 30_000,
	});
	assert.equal(installed.status, 0, installed.stderr || installed.stdout || "pi install failed");
	const settings = JSON.parse(readFileSync(join(agentDirectory, "settings.json"), "utf8"));
	assert.equal(settings.packages.length, 1, "pi install must register exactly one package");

	const child = spawn(
		process.execPath,
		[cli, "--mode", "rpc", "--no-session", "--no-skills", "--no-prompt-templates", "--no-context-files"],
		{ cwd: home, env, stdio: ["pipe", "pipe", "pipe"] },
	);

	let stdout = "";
	let stderr = "";
	let commandsLoaded = false;
	let stateLoaded = false;
	let timedOut = false;
	const deadline = setTimeout(() => {
		timedOut = true;
		child.kill("SIGKILL");
	}, 15_000);

	child.stderr.on("data", (chunk) => {
		stderr += chunk.toString();
	});
	child.stdout.on("data", (chunk) => {
		stdout += chunk.toString();
		let newline = stdout.indexOf("\n");
		while (newline >= 0) {
			const line = stdout.slice(0, newline);
			stdout = stdout.slice(newline + 1);
			try {
				const message = JSON.parse(line);
				if (message.id === "state") stateLoaded = message.success === true;
				if (message.id === "commands") {
					const names = new Set(message.data?.commands?.map((command) => command.name));
					commandsLoaded = message.success === true && names.has("timing");
					child.kill("SIGTERM");
				}
			} catch {}
			newline = stdout.indexOf("\n");
		}
	});
	child.stdin.write(`${JSON.stringify({ id: "state", type: "get_state" })}\n`);
	child.stdin.write(`${JSON.stringify({ id: "commands", type: "get_commands" })}\n`);

	const code = await new Promise((resolveClose) => child.on("close", resolveClose));
	clearTimeout(deadline);
	const loaderError = /Failed to load extension|Error loading extension|Cannot find module|ERR_MODULE_NOT_FOUND/i.test(
		stderr,
	);
	assert.equal(timedOut, false, "fresh Pi RPC smoke test timed out");
	assert.equal(loaderError, false, stderr);
	assert.equal(stateLoaded, true, "fresh Pi did not answer get_state");
	assert.equal(commandsLoaded, true, "packed extension did not register /timing");

	console.log(
		JSON.stringify(
			{
				package: filename,
				install: "pi install <extracted npm artifact>",
				scope: "temporary HOME; offline; no credentials, sessions, skills, prompts, context files, or provider calls",
				stateLoaded,
				commandsLoaded,
				loaderError,
				timedOut,
				code,
			},
			null,
			2,
		),
	);
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
