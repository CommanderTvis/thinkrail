#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TEXT_MARKERS: readonly { needle: string; reason: string }[] = [
	{ needle: "node:fs", reason: "a Node builtin — only the host may touch the filesystem" },
	{ needle: "@anthropic-ai/sdk", reason: "a provider SDK — only the host may talk to a provider" },
	{ needle: "openai", reason: "a provider SDK — only the host may talk to a provider" },
	{
		needle: "~kind",
		reason:
			"a typebox schema constructed as a value at module load — see packages/contracts/SPEC.md",
	},
];

const HOST_MODULE_PATTERN = /@thinkrail\/plugin-[a-z0-9-]+\/host\b/;

function findings(distAssets: string): string[] {
	const violations: string[] = [];
	const files = readdirSync(distAssets).filter((file) => file.endsWith(".js"));
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
