#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TEXT_MARKERS: readonly { needle: string; reason: string }[] = [
	{ needle: "node:fs", reason: "a Node builtin — only the host may touch the filesystem" },
	{ needle: "@anthropic-ai/sdk", reason: "a provider SDK — only the host may talk to a provider" },
	{ needle: "api.openai.com", reason: "a provider SDK — only the host may talk to a provider" },
	{
		needle: "~kind",
		reason:
			"a typebox schema constructed as a value at module load — see packages/contracts/SPEC.md",
	},
];

const HOST_MODULE_PATTERN = /@thinkrail\/plugin-[a-z0-9-]+\/host\b/;

/** Marks the tab-host worker's entry chunk: its OPFS directory name, from `@thinkrail/tab-host`. */
const TAB_HOST_MARKER = /["'`]thinkrail-tab-host["'`]/;
const CHUNK_IMPORT = /["'`]\.\/([\w.-]+\.js)["'`]/g;

/**
 * The tab-host worker and every chunk it reaches: a host running in the tab, so the host-only
 * markers below are what it is made of rather than leaks into the page.
 */
function tabHostChunks(distAssets: string, files: readonly string[]): Set<string> {
	const reached = new Set<string>();
	const queue = files.filter((file) =>
		TAB_HOST_MARKER.test(readFileSync(join(distAssets, file), "utf8")),
	);
	const isWorkerEntry = (file: string) => /^worker-/.test(file);
	for (const file of queue.filter(isWorkerEntry)) reached.add(file);
	const pending = [...reached];
	while (pending.length > 0) {
		const file = pending.pop() as string;
		for (const [, next] of readFileSync(join(distAssets, file), "utf8").matchAll(CHUNK_IMPORT)) {
			if (next && !reached.has(next) && files.includes(next)) {
				reached.add(next);
				pending.push(next);
			}
		}
	}
	return reached;
}

function findings(distAssets: string): string[] {
	const violations: string[] = [];
	const all = readdirSync(distAssets).filter((file) => file.endsWith(".js"));
	const tabHost = tabHostChunks(distAssets, all);
	const files = all.filter((file) => !tabHost.has(file));
	for (const file of files) {
		if (/^host[-.]/.test(file)) {
			violations.push(
				`${file}: chunk name looks like a plugin's host half was bundled for the browser`,
			);
		}
		const text = readFileSync(join(distAssets, file), "utf8");
		for (const { needle, reason } of TEXT_MARKERS) {
			if (text.includes(needle))
				violations.push(`${file}: contains ${JSON.stringify(needle)} — ${reason}`);
		}
		const hostModule = text.match(HOST_MODULE_PATTERN)?.[0];
		if (hostModule !== undefined) {
			violations.push(
				`${file}: contains plugin host module id ${JSON.stringify(hostModule)} — a plugin's host half must never reach the browser bundle`,
			);
		}
	}
	return violations.sort();
}

const repoRoot = join(import.meta.dir, "..");
const distAssets = join(repoRoot, "apps", "web", "dist", "assets");
if (!existsSync(distAssets)) {
	console.error(
		`check-web-bundle: ${distAssets} does not exist — run \`bun run build:web\` first.`,
	);
	process.exit(1);
}

const violations = findings(distAssets);
if (violations.length > 0) {
	console.error("check-web-bundle: the web bundle contains what it must not:");
	for (const violation of violations) console.error(`  - ${violation}`);
	process.exit(1);
}
console.log("check-web-bundle: OK");
