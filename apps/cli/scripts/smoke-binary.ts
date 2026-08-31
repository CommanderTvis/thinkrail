#!/usr/bin/env bun

import { existsSync, globSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import {
	type ArtifactHostAdapter,
	type RunningArtifactHost,
	runArtifactHostProbes,
} from "@thinkrail/server/artifact-probes";
import { binaryArtifactName } from "./artifactName";

const binary = resolve(
	process.argv[2] ?? join(import.meta.dir, "..", "dist", binaryArtifactName()),
);
if (!existsSync(binary)) {
	console.error(`binary not found at ${binary} — run \`bun run build:binary\` first.`);
	process.exit(1);
}

function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${what}`)), ms),
		),
	]);
}

async function readServingUrl(stdout: ReadableStream<Uint8Array>): Promise<string> {
	const decoder = new TextDecoder();
	let buffered = "";
	for await (const chunk of stdout) {
		buffered += decoder.decode(chunk, { stream: true });
		const match = buffered.match(/thinkrail → (http:\/\/\S+)/);
		if (match?.[1]) return match[1];
	}
	throw new Error(`stdout closed without a serving URL: ${JSON.stringify(buffered)}`);
}

interface AcpFrame {
	id?: number;
	result?: unknown;
	error?: { code: number; message: string };
}

async function acpInitializeHandshake(env: Record<string, string>, label: string): Promise<void> {
	const proc = Bun.spawn([binary, "acp-pi"], {
		env,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "inherit",
	});
	const reader = proc.stdout.getReader();
	const decoder = new TextDecoder();
	let buffered = "";

	async function readFrame(): Promise<AcpFrame> {
		while (true) {
			const newline = buffered.indexOf("\n");
			if (newline === -1) {
				const { value, done } = await reader.read();
				if (done) throw new Error(`${label}: stdout closed before an initialize response arrived`);
				buffered += decoder.decode(value, { stream: true });
				continue;
			}
			const line = buffered.slice(0, newline);
			buffered = buffered.slice(newline + 1);
			if (line.trim().length === 0) continue;
			return JSON.parse(line) as AcpFrame;
		}
	}

	try {
		proc.stdin.write(
			`${JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: 1,
					clientCapabilities: {
						fs: { readTextFile: false, writeTextFile: false },
						terminal: false,
					},
					clientInfo: { name: "thinkrail-smoke", version: "0.0.0" },
				},
			})}\n`,
		);
		let frame = await within(readFrame(), 30_000, `${label} ACP initialize`);
		while (frame.id !== 1) frame = await within(readFrame(), 30_000, `${label} ACP initialize`);
		if (frame.error) throw new Error(`${label}: initialize answered ${frame.error.message}`);
		const result = frame.result as { protocolVersion?: unknown } | undefined;
		if (typeof result?.protocolVersion !== "number") {
			throw new Error(`${label}: initialize answered no protocolVersion`);
		}
	} finally {
		reader.releaseLock();
		proc.kill("SIGTERM");
		await within(proc.exited, 10_000, `${label} shutdown`).catch(() => proc.kill("SIGKILL"));
	}
}

let launchSequence = 0;
const adapter: ArtifactHostAdapter = {
	name: "cli-binary",
	async launch(env, label): Promise<RunningArtifactHost> {
		const port = 24262 + launchSequence++ * 50;
		const proc = Bun.spawn([binary, "--no-open", "--port", String(port)], {
			env,
			stdout: "pipe",
			stderr: "inherit",
		});
		const origin = await within(
			Promise.race([
				readServingUrl(proc.stdout),
				proc.exited.then((code) => {
					throw new Error(`${label} CLI host exited early with ${code}`);
				}),
			]),
			30_000,
			`${label} CLI ready`,
		);
		const cache = env.XDG_CACHE_HOME;
		if (!cache) throw new Error("XDG_CACHE_HOME is missing");
		const skillsDir = globSync(join(cache, "thinkrail", "skills", "*")).find((path) =>
			existsSync(join(path, "brainstorming", "SKILL.md")),
		);
		const runtimeDir = globSync(join(cache, "thinkrail", "runtime", "*")).find((path) =>
			existsSync(join(path, "macos-trash")),
		);
		if (!skillsDir || !runtimeDir) throw new Error("CLI staged resources were not found");
		let stopped = false;
		return {
			origin,
			resources: {
				skillsDir,
				trashHelpers: {
					macos: join(runtimeDir, "macos-trash"),
					windows: join(runtimeDir, "windows-trash.exe"),
				},
			},
			async stop() {
				if (stopped) return;
				stopped = true;
				proc.kill("SIGTERM");
				const code = await within(proc.exited, 15_000, `${label} CLI shutdown`);
				if (process.platform !== "win32" && code !== 0) {
					throw new Error(`${label} CLI shutdown exited ${code}`);
				}
			},
		};
	},
};

const temp = mkdtempSync(join(tmpdir(), "thinkrail-cli-artifact-"));
try {
	const home = join(temp, "home");
	const cache = join(temp, "cache");
	const project = join(temp, "project");
	const marker = join(project, "preload-ran");
	mkdirSync(home, { recursive: true });
	mkdirSync(project, { recursive: true });
	writeFileSync(join(project, "bunfig.toml"), 'preload = ["./preload.ts"]\n');
	writeFileSync(
		join(project, "preload.ts"),
		`import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "ran");\n`,
	);
	const subcommand = Bun.spawnSync([binary, "uninstall", "--help"], {
		env: {
			...process.env,
			XDG_CACHE_HOME: cache,
			HOME: home,
			THINKRAIL_NO_ANALYTICS: "1",
		},
		stdout: "pipe",
		stderr: "inherit",
		cwd: project,
	});
	if (!subcommand.success) throw new Error(`uninstall --help exited ${subcommand.exitCode}`);
	if (!subcommand.stdout.toString().includes("thinkrail uninstall")) {
		throw new Error("uninstall --help printed no usage");
	}
	if (existsSync(marker)) throw new Error("compiled binary executed a project bunfig preload");
	if (existsSync(join(cache, "thinkrail"))) {
		throw new Error("exit-only subcommand staged embedded assets");
	}
	const noPiPath = (process.env.PATH ?? "")
		.split(delimiter)
		.filter((entry) => entry.length > 0 && !Bun.which("pi", { PATH: entry }))
		.join(delimiter);
	if (Bun.which("pi", { PATH: noPiPath })) throw new Error("smoke PATH still contains pi");
	const agentEnv = {
		HOME: home,
		USERPROFILE: home,
		PATH: noPiPath,
		PI_OFFLINE: "1",
		THINKRAIL_NO_ANALYTICS: "1",
		XDG_CACHE_HOME: cache,
	};
	await acpInitializeHandshake(agentEnv, "acp-pi (default agent dir)");
	await acpInitializeHandshake(
		{ ...agentEnv, PI_CODING_AGENT_DIR: join(temp, "pi-agent") },
		"acp-pi (custom agent dir)",
	);
	await runArtifactHostProbes(adapter);
	console.log(`smoke OK: ${binary} passed CLI-only, acp-pi and shared artifact probes.`);
} catch (error) {
	console.error(`smoke FAILED: ${error instanceof Error ? error.message : error}`);
	process.exitCode = 1;
} finally {
	rmSync(temp, { recursive: true, force: true });
}
