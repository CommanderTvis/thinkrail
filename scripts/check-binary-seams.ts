#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import ts from "typescript";

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

const SOURCE_ALLOWLIST: Record<string, { reason: string; imports: string[] }> = {
	"packages/server/src/plugins/external.ts": {
		reason:
			"deliberate — importExternalHost() loads an external plugin's host module from an " +
			"absolute, content-hashed file:// URL known only at runtime, so it can never be a static " +
			"import; see plugin-adoption.md S11 and smoke:binary",
		imports: ["moduleUrl"],
	},
};

const SOURCE_EXCLUDED_DIRS = new Set(["node_modules", "dist", "build", ".git"]);

function pluginHostDirs(repoRoot: string): string[] {
	const packagesDir = join(repoRoot, "packages");
	const dirs: string[] = [];
	for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
		if (!entry.isDirectory() || !entry.name.startsWith("plugin-")) continue;
		const hostDir = join(packagesDir, entry.name, "host");
		if (existsSync(hostDir) && statSync(hostDir).isDirectory()) dirs.push(hostDir);
	}
	return dirs;
}

function listSourceFiles(dir: string): string[] {
	if (!existsSync(dir)) return [];
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

const SKIPPED_DIST_DIRS: Record<string, string> = {
	"pi-coding-agent/dist/bundle":
		"CLI/RPC-only bundled runtime (reachable only via pi's bin and the ./rpc-entry export) — " +
		"the in-process library import ('.' → dist/index.js) never loads it, so its opaque imports " +
		"(content-hashed chunk duplicates of the allowlisted modular seams) never run in the compiled binary",
};

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

function opaqueImportsIn(
	fileName: string,
	source: string,
	kind: ts.ScriptKind = ts.ScriptKind.JS,
): string[] {
	const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, kind);
	const found: string[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
			const specifier = node.arguments[0];
			const isConstant =
				specifier !== undefined &&
				(ts.isStringLiteral(specifier) || ts.isNoSubstitutionTemplateLiteral(specifier));
			if (!isConstant) {
				found.push(
					specifier ? specifier.getText(sourceFile).replace(/\s+/g, " ").trim() : "<no argument>",
				);
			}
		}
		ts.forEachChild(node, visit);
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

const found = new Map<string, string[]>();
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
		const source = readFileSync(file, "utf8");
		if (!/\bimport\s*\(/.test(source)) continue;
		const imports = opaqueImportsIn(file, source);
		if (imports.length === 0) continue;
		found.set(id, imports);
	}
}

const unexpected: string[] = [];
const stale: string[] = [];
for (const id of new Set([...found.keys(), ...Object.keys(ALLOWLIST)])) {
	const actual = [...(found.get(id) ?? [])];
	const expected = [...(ALLOWLIST[id]?.imports ?? [])].sort();
	for (const imp of expected) {
		const at = actual.indexOf(imp);
		if (at >= 0) actual.splice(at, 1);
		else stale.push(`${id}: import(${imp})  (${ALLOWLIST[id]?.reason})`);
	}
	unexpected.push(...actual.map((imp) => `${id}: import(${imp})`));
}
const sourceFound = new Map<string, string[]>();
for (const dir of [
	join(repoRoot, "packages", "plugin-api", "src"),
	...pluginHostDirs(repoRoot),
	join(repoRoot, "packages", "server", "src", "plugins"),
]) {
	for (const file of listSourceFiles(dir)) {
		const source = readFileSync(file, "utf8");
		if (!/\bimport\s*\(/.test(source)) continue;
		const imports = opaqueImportsIn(
			file,
			source,
			file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
		);
		if (imports.length > 0) sourceFound.set(relative(repoRoot, file).split(sep).join("/"), imports);
	}
}
for (const id of new Set([...sourceFound.keys(), ...Object.keys(SOURCE_ALLOWLIST)])) {
	const actual = [...(sourceFound.get(id) ?? [])];
	const expected = [...(SOURCE_ALLOWLIST[id]?.imports ?? [])].sort();
	for (const imp of expected) {
		const at = actual.indexOf(imp);
		if (at >= 0) actual.splice(at, 1);
		else stale.push(`${id}: import(${imp})  (${SOURCE_ALLOWLIST[id]?.reason})`);
	}
	unexpected.push(...actual.map((imp) => `${id}: import(${imp})`));
}
for (const [dir, reason] of Object.entries(SKIPPED_DIST_DIRS)) {
	if (!usedSkips.has(dir)) stale.push(`${dir}: skipped dist dir no longer present  (${reason})`);
}

if (unexpected.length > 0) {
	console.error(
		"check-binary-seams: NEW bundler-opaque dynamic import(s) in pi — the compiled binary cannot resolve these at runtime:",
	);
	for (const line of unexpected.sort()) console.error(`  - ${line}`);
	console.error(
		"\nVerify each one: register a static seam in registerBundledRuntime (packages/server/src/agent/extensions.ts),",
	);
	console.error(
		"or confirm it only receives node: builtins — then allowlist the occurrence in scripts/check-binary-seams.ts with that justification.",
	);
	console.error(
		"For a plugin-host import: it almost certainly reaches outside the binary — make it static, or allowlist it in SOURCE_ALLOWLIST with the reason.",
	);
}
if (stale.length > 0) {
	console.error(
		"check-binary-seams: stale allowlist occurrence(s) — pi moved, removed, or reshaped these imports:",
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
	`check-binary-seams: OK (${occurrences} known opaque import occurrences in ${found.size} files across ${roots.size} pi packages; ${sourceOccurrences} in ${sourceFound.size} plugin-host source file(s), all handled or safe)`,
);
