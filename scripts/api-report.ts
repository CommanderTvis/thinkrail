#!/usr/bin/env bun

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

interface ApiEntry {
	name: string;
	source: string;
}

interface ApiPackage {
	pkg: string;
	entries: readonly ApiEntry[];
}

const PACKAGES: readonly ApiPackage[] = [
	{
		pkg: "packages/plugin-api",
		entries: [
			{ name: "index", source: "index.ts" },
			{ name: "host", source: "host/index.ts" },
			{ name: "web", source: "web/index.ts" },
		],
	},
	{
		pkg: "packages/plugin-ui",
		entries: [
			{ name: "index", source: "index.ts" },
			{ name: "markdown", source: "markdown/index.ts" },
			{ name: "editor", source: "editor/index.ts" },
			{ name: "visualization", source: "visualization/index.ts" },
		],
	},
];

function relativeSpecifiers(text: string): string[] {
	const found = new Set<string>();
	for (const match of text.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
		if (match[1]?.startsWith(".")) found.add(match[1]);
	}
	for (const match of text.matchAll(/\bimport\(["']([^"']+)["']\)/g)) {
		if (match[1]?.startsWith(".")) found.add(match[1]);
	}
	return [...found];
}

function resolveDeclaration(fromFile: string, specifier: string): string | null {
	const base = resolve(dirname(fromFile), specifier);
	for (const candidate of [`${base}.d.ts`, join(base, "index.d.ts")]) {
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

function stripSourceMappingUrl(text: string): string {
	return text.replace(/^\/\/# sourceMappingURL=.*$/gm, "").trimEnd();
}

function transitiveClosure(entryFile: string): string[] {
	const order: string[] = [];
	const visited = new Set<string>();
	const visit = (file: string): void => {
		if (visited.has(file)) return;
		visited.add(file);
		order.push(file);
		for (const specifier of relativeSpecifiers(readFileSync(file, "utf8"))) {
			const resolved = resolveDeclaration(file, specifier);
			if (resolved !== null) visit(resolved);
		}
	};
	visit(entryFile);
	return order;
}

function renderEntry(outDir: string, entry: ApiEntry): string {
	const entryFile = join(outDir, entry.source.replace(/\.ts$/, ".d.ts"));
	const [first, ...rest] = transitiveClosure(entryFile);
	rest.sort((a, b) => relative(outDir, a).localeCompare(relative(outDir, b)));
	const ordered = first === undefined ? [] : [first, ...rest];
	return ordered
		.map((file) => {
			const label = relative(outDir, file).split(sep).join("/");
			return `// ---- ${label} ----\n${stripSourceMappingUrl(readFileSync(file, "utf8"))}`;
		})
		.join("\n\n");
}

async function emitDeclarations(pkgDir: string, outDir: string): Promise<void> {
	const proc = Bun.spawn(["bunx", "tsc", "-p", "tsconfig.api.json", "--outDir", outDir], {
		cwd: pkgDir,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (exitCode !== 0) {
		throw new Error(`tsc -p ${pkgDir}/tsconfig.api.json failed:\n${stdout}${stderr}`);
	}
}

async function buildReports(repoRoot: string): Promise<Map<string, Map<string, string>>> {
	const reports = new Map<string, Map<string, string>>();
	for (const { pkg, entries } of PACKAGES) {
		const outDir = mkdtempSync(join(tmpdir(), "thinkrail-api-report-"));
		try {
			await emitDeclarations(join(repoRoot, pkg), outDir);
			const perEntry = new Map<string, string>();
			for (const entry of entries) perEntry.set(entry.name, renderEntry(outDir, entry));
			reports.set(pkg, perEntry);
		} finally {
			rmSync(outDir, { recursive: true, force: true });
		}
	}
	return reports;
}

const mode = process.argv[2];
if (mode !== "update" && mode !== "check") {
	console.error("usage: bun scripts/api-report.ts <update|check>");
	process.exit(1);
}

const repoRoot = join(import.meta.dir, "..");
const reports = await buildReports(repoRoot);

if (mode === "update") {
	for (const [pkg, perEntry] of reports) {
		const apiDir = join(repoRoot, pkg, "api");
		mkdirSync(apiDir, { recursive: true });
		for (const [entry, content] of perEntry) {
			writeFileSync(join(apiDir, `${entry}.d.ts.api`), `${content}\n`);
		}
	}
	console.log("api-report: updated");
} else {
	const violations: string[] = [];
	for (const [pkg, perEntry] of reports) {
		for (const [entry, content] of perEntry) {
			const committedPath = join(repoRoot, pkg, "api", `${entry}.d.ts.api`);
			const expected = `${content}\n`;
			if (!existsSync(committedPath)) {
				violations.push(`${pkg}/api/${entry}.d.ts.api is missing — run \`bun run api:update\``);
			} else if (readFileSync(committedPath, "utf8") !== expected) {
				violations.push(`${pkg}/api/${entry}.d.ts.api is stale — run \`bun run api:update\``);
			}
		}
	}
	if (violations.length > 0) {
		console.error("api-report: the committed API surface is out of date:");
		for (const violation of violations) console.error(`  - ${violation}`);
		process.exit(1);
	}
	console.log("api-report: OK");
}
