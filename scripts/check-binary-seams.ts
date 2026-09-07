#!/usr/bin/env bun

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import {
	isCallExpression,
	isNoSubstitutionTemplateLiteral,
	isStringLiteral,
	type Node,
	type SourceFile,
	SyntaxKind,
} from "typescript/unstable/ast";
import { parseFiles } from "./tsProjects";

const ALLOWLIST: Record<string, { reason: string; imports: string[] }> = {
	"pi-ai/dist/auth/oauth/load.js": {
		reason: "handled — registerBunOAuthFlows() registered in registerBundledRuntime",
		imports: ["__rewriteRelativeImportExtension(runtimeSpecifier)"],
	},
	"pi-ai/dist/api/bedrock-converse-stream.lazy.js": {
		reason: "handled — setBedrockProviderModule() registered in registerBundledRuntime",
		imports: ["__rewriteRelativeImportExtension(runtimeSpecifier)"],
	},
	"pi-ai/dist/auth/context.js": {
		reason:
			"safe — the importNodeModule wrapper only ever receives node: builtin specifiers " +
			"(a compiled binary resolves those at runtime)",
		imports: ["__rewriteRelativeImportExtension(specifier)"],
	},
	"pi-ai/dist/env-api-keys.js": {
		reason:
			"safe — the dynamicImport wrapper only ever receives node: builtin specifiers " +
			"(a compiled binary resolves those at runtime)",
		imports: ["__rewriteRelativeImportExtension(specifier)"],
	},
};

const SKIPPED_DIST_DIRS: Record<string, string> = {
	"pi-coding-agent/dist/bundle":
		"CLI/RPC-only bundled runtime (reachable only via pi's bin and the ./rpc-entry export) — " +
		"the in-process library import ('.' → dist/index.js) never loads it, so its opaque imports " +
		"(content-hashed chunk duplicates of the allowlisted modular seams) never run in the compiled binary",
};

const SOURCE_ALLOWLIST: Record<string, { reason: string; imports: string[] }> = {};

const SOURCE_EXCLUDED_DIRS = new Set(["node_modules", "dist", "build", ".git"]);

function listSourceFiles(dir: string): string[] {
	const out: string[] = [];
	const visit = (path: string): void => {
		for (const entry of readdirSync(path, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				if (!SOURCE_EXCLUDED_DIRS.has(entry.name)) visit(join(path, entry.name));
			} else if (/\.tsx?$/.test(entry.name)) {
				out.push(join(path, entry.name));
			}
		}
	};
	visit(dir);
	return out;
}

function reconcileOpaqueImports(
	found: ReadonlyMap<string, string[]>,
	allowlist: Record<string, { reason: string; imports: string[] }>,
): { unexpected: string[]; stale: string[] } {
	const unexpected: string[] = [];
	const stale: string[] = [];
	for (const id of new Set([...found.keys(), ...Object.keys(allowlist)])) {
		const actual = [...(found.get(id) ?? [])];
		const expected = [...(allowlist[id]?.imports ?? [])].sort();
		for (const imp of expected) {
			const at = actual.indexOf(imp);
			if (at >= 0) actual.splice(at, 1);
			else stale.push(`${id}: import(${imp})  (${allowlist[id]?.reason})`);
		}
		unexpected.push(...actual.map((imp) => `${id}: import(${imp})`));
	}
	return { unexpected, stale };
}

function packageRoot(name: string, entry: string): string {
	const marker = `${sep}@earendil-works${sep}${name}${sep}`;
	const at = entry.lastIndexOf(marker);
	if (at < 0) throw new Error(`cannot locate package root for ${name} from ${entry}`);
	return entry.slice(0, at + marker.length - 1);
}

function listJsFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...listJsFiles(full));
		else if (full.endsWith(".js")) out.push(full);
	}
	return out;
}

function opaqueImportsIn(sourceFile: SourceFile): string[] {
	const found: string[] = [];
	const visit = (node: Node): void => {
		if (isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword) {
			const specifier = node.arguments[0];
			const isConstant =
				specifier !== undefined &&
				(isStringLiteral(specifier) || isNoSubstitutionTemplateLiteral(specifier));
			if (!isConstant) {
				found.push(
					specifier ? specifier.getText(sourceFile).replace(/\s+/g, " ").trim() : "<no argument>",
				);
			}
		}
		node.forEachChild(visit);
	};
	visit(sourceFile);
	return found.sort();
}

const repoRoot = resolve(import.meta.dir, "..");
const roots = new Map<string, string>();
const queue: { name: string; root: string }[] = [];
const enqueue = (name: string, resolveFrom: string): void => {
	if (roots.has(name)) return;
	const root = packageRoot(name, Bun.resolveSync(`@earendil-works/${name}`, resolveFrom));
	roots.set(name, root);
	queue.push({ name, root });
};
enqueue("pi-coding-agent", join(repoRoot, "packages", "server"));
for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
	const { root } = next;
	const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
		dependencies?: Record<string, string>;
	};
	for (const dep of Object.keys(pkg.dependencies ?? {})) {
		if (dep.startsWith("@earendil-works/")) enqueue(dep.slice("@earendil-works/".length), root);
	}
}

const candidates: { id: string; file: string }[] = [];
const usedSkips = new Set<string>();
for (const [name, root] of roots) {
	for (const file of listJsFiles(join(root, "dist"))) {
		const id = `${name}/${file
			.slice(root.length + 1)
			.split(sep)
			.join("/")}`;
		const skipped = Object.keys(SKIPPED_DIST_DIRS).find((dir) => id.startsWith(`${dir}/`));
		if (skipped !== undefined) {
			usedSkips.add(skipped);
			continue;
		}
		if (!/\bimport\s*\(/.test(readFileSync(file, "utf8"))) continue;
		candidates.push({ id, file });
	}
}

const found = new Map<string, string[]>();
await parseFiles(
	repoRoot,
	candidates.map((candidate) => candidate.file),
	async (parsed) => {
		for (const { id, file } of candidates) {
			const imports = opaqueImportsIn(await parsed(file));
			if (imports.length > 0) found.set(id, imports);
		}
	},
);

const { unexpected: piUnexpected, stale: piStale } = reconcileOpaqueImports(found, ALLOWLIST);
for (const [dir, reason] of Object.entries(SKIPPED_DIST_DIRS)) {
	if (!usedSkips.has(dir)) piStale.push(`${dir}: skipped dist dir no longer present  (${reason})`);
}

const sourceCandidates: { id: string; file: string }[] = [];
for (const dir of []) {
	for (const file of listSourceFiles(dir)) {
		if (!/\bimport\s*\(/.test(readFileSync(file, "utf8"))) continue;
		sourceCandidates.push({ id: relative(repoRoot, file).split(sep).join("/"), file });
	}
}

const sourceFound = new Map<string, string[]>();
await parseFiles(
	repoRoot,
	sourceCandidates.map((candidate) => candidate.file),
	async (parsed) => {
		for (const { id, file } of sourceCandidates) {
			const imports = opaqueImportsIn(await parsed(file));
			if (imports.length > 0) sourceFound.set(id, imports);
		}
	},
);
const { unexpected: sourceUnexpected, stale: sourceStale } = reconcileOpaqueImports(
	sourceFound,
	SOURCE_ALLOWLIST,
);

const unexpected = [...piUnexpected, ...sourceUnexpected];
const stale = [...piStale, ...sourceStale];

if (unexpected.length > 0) {
	console.error(
		"check-binary-seams: NEW bundler-opaque dynamic import(s) — the compiled binary cannot resolve these at runtime:",
	);
	for (const line of unexpected.sort()) console.error(`  - ${line}`);
	console.error(
		"\nFor a pi import: register a static seam in registerBundledRuntime (packages/server/src/agent/extensions.ts),",
	);
	console.error(
		"or confirm it only receives node: builtins. For a source import: it almost certainly reaches outside the",
	);
	console.error(
		"static builtin-plugin array — see plugin-adoption.md S11. Either way, allowlist a deliberate occurrence in",
	);
	console.error("scripts/check-binary-seams.ts with that justification.");
}
if (stale.length > 0) {
	console.error(
		"check-binary-seams: stale allowlist occurrence(s) — the source moved, was removed, or was reshaped:",
	);
	for (const line of stale.sort()) console.error(`  - ${line}`);
	console.error(
		"\nRe-verify the seam still covers the replacement, then update the allowlist in scripts/check-binary-seams.ts.",
	);
}
if (unexpected.length > 0 || stale.length > 0) process.exit(1);

const occurrences = [...found.values()].reduce((n, imports) => n + imports.length, 0);
const sourceOccurrences = [...sourceFound.values()].reduce((n, imports) => n + imports.length, 0);
console.log(
	`check-binary-seams: OK (${occurrences} known opaque import occurrences in ${found.size} files across ${roots.size} pi packages; ` +
		`${sourceOccurrences} in ${sourceFound.size} source file(s), all handled or safe)`,
);
