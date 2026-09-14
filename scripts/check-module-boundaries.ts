#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
	isCallExpression,
	isExportDeclaration,
	isExternalModuleReference,
	isIdentifier,
	isImportDeclaration,
	isImportEqualsDeclaration,
	isImportTypeNode,
	isLiteralTypeNode,
	isNamedExports,
	isNamedImports,
	isStringLiteralLikeNode,
	type Node,
	type SourceFile,
	SyntaxKind,
} from "typescript/unstable/ast";
import { parseFiles } from "./tsProjects";

interface Manifest {
	name?: string;
	exports?: unknown;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
}

interface ModuleRuleEntry {
	target: string;
	subpath?: string;
	typesOnly?: boolean;
	from?: string;
}

type ModuleRuleAllowed = string | ModuleRuleEntry;

interface ModuleInternalRule {
	from: string;
	forbid: readonly string[];
}

interface ModuleRule {
	root: string;
	allowed: readonly ModuleRuleAllowed[];
	internal?: readonly ModuleInternalRule[];
}

const PLUGIN_WEB_MUST_NOT_REACH_HOST: readonly ModuleInternalRule[] = [
	{ from: "web", forbid: ["host"] },
];

const MODULE_RULES: readonly ModuleRule[] = [
	{
		root: "packages/artifact-tests",
		allowed: ["apps/cli", "packages/server", "packages/shared"],
	},
	{ root: "packages/contracts", allowed: [] },
	{ root: "packages/plugin-ui", allowed: [] },
	{ root: "packages/plugin-api", allowed: ["packages/contracts"] },
	{
		root: "packages/plugin-spec-dialect",
		allowed: [
			"packages/plugin-api",
			"packages/contracts",
			"packages/shared",
			"packages/plugin-ui",
			"packages/spec-graph",
		],
		internal: PLUGIN_WEB_MUST_NOT_REACH_HOST,
	},
	{ root: "packages/shared", allowed: ["packages/contracts"] },
	{ root: "packages/pi-delegation", allowed: [] },
	{ root: "packages/pi-subagents", allowed: ["packages/pi-delegation"] },
	{
		root: "packages/server",
		allowed: [
			"packages/contracts",
			"packages/plugin-api",
			...(["plugin-spec-dialect"] as const).flatMap((plugin) =>
				(["./host", "./manifest", "./contracts", "./build-support"] as const).map((subpath) => ({
					target: `packages/${plugin}`,
					subpath,
				})),
			),
			"packages/shared",
			"packages/spec-graph",
			"packages/pi-delegation",
			"packages/pi-subagents",
			"packages/pi-thinkrail-workflow",
			"packages/pi-todos",
			"packages/pi-visualize",
		],
	},
	{
		root: "apps/web",
		allowed: [
			"packages/contracts",
			"packages/plugin-ui",
			"packages/plugin-api",
			...(["plugin-spec-dialect"] as const).flatMap((plugin) => [
				{ target: `packages/${plugin}`, subpath: "./manifest" },
				{ target: `packages/${plugin}`, subpath: "./web" },
				{ target: `packages/${plugin}`, subpath: "./contracts", typesOnly: true },
			]),
		],
	},
	{
		root: "apps/cli",
		allowed: [
			"packages/server",
			"packages/shared",
			...(["plugin-spec-dialect"] as const).map((plugin) => ({
				target: `packages/${plugin}`,
				subpath: "./build-support",
			})),
		],
	},
	{
		root: "apps/desktop",
		allowed: [
			"packages/server",
			"packages/shared",
			"packages/contracts",
			...(["plugin-spec-dialect"] as const).map((plugin) => ({
				target: `packages/${plugin}`,
				subpath: "./build-support",
			})),
		],
	},
];

const DEPENDENCY_SECTIONS = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
] as const;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const EXCLUDED_DIRECTORIES = new Set([
	".git",
	".hutch",
	".cottontail-tmp",
	".stage",
	"artifacts",
	"build",
	"dist",
	"node_modules",
]);

function normalized(path: string): string {
	return path.split(sep).join("/");
}

interface WorkspacePackage {
	root: string;
	exports: ReadonlySet<string>;
}

function exportsKeys(manifest: Manifest): ReadonlySet<string> {
	const value = manifest.exports;
	if (typeof value === "string") return new Set(["."]);
	if (typeof value === "object" && value !== null) return new Set(Object.keys(value));
	return new Set();
}

function workspacePackages(root: string): Map<string, WorkspacePackage> {
	const packages = new Map<string, WorkspacePackage>();
	for (const base of ["apps", "packages"]) {
		const basePath = join(root, base);
		if (!existsSync(basePath)) continue;
		for (const entry of readdirSync(basePath, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const moduleRoot = `${base}/${entry.name}`;
			const manifestPath = join(root, moduleRoot, "package.json");
			if (!existsSync(manifestPath)) continue;
			const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
			if (manifest.name) {
				packages.set(manifest.name, { root: moduleRoot, exports: exportsKeys(manifest) });
			}
		}
	}
	return packages;
}

function sourceFiles(root: string): string[] {
	const files: string[] = [];
	const visit = (path: string): void => {
		for (const entry of readdirSync(path, { withFileTypes: true })) {
			if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
			const child = join(path, entry.name);
			if (entry.isDirectory()) visit(child);
			else if (SOURCE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf("."))))
				files.push(child);
		}
	};
	visit(root);
	return files;
}

interface ImportSpecifier {
	specifier: string;
	typeOnly: boolean;
}

function importSpecifiers(source: SourceFile): ImportSpecifier[] {
	const specifiers: ImportSpecifier[] = [];
	const add = (node: Node | undefined, typeOnly: boolean): void => {
		if (node !== undefined && isStringLiteralLikeNode(node))
			specifiers.push({ specifier: node.text, typeOnly });
	};
	const visit = (node: Node): void => {
		if (isImportDeclaration(node)) {
			const namedBindings = node.importClause?.namedBindings;
			add(
				node.moduleSpecifier,
				node.importClause?.phaseModifier === SyntaxKind.TypeKeyword ||
					(namedBindings !== undefined &&
						isNamedImports(namedBindings) &&
						namedBindings.elements.every((e) => e.isTypeOnly)),
			);
		} else if (isExportDeclaration(node)) {
			const exportClause = node.exportClause;
			add(
				node.moduleSpecifier,
				node.isTypeOnly ||
					(exportClause !== undefined &&
						isNamedExports(exportClause) &&
						exportClause.elements.every((e) => e.isTypeOnly)),
			);
		} else if (isImportEqualsDeclaration(node) && isExternalModuleReference(node.moduleReference)) {
			add(node.moduleReference.expression, node.isTypeOnly);
		} else if (isCallExpression(node)) {
			if (
				node.expression.kind === SyntaxKind.ImportKeyword ||
				(isIdentifier(node.expression) && node.expression.text === "require")
			) {
				add(node.arguments[0], false);
			}
		} else if (isImportTypeNode(node) && isLiteralTypeNode(node.argument)) {
			add(node.argument.literal, true);
		}
		node.forEachChild(visit);
	};
	visit(source);
	return specifiers;
}

interface ResolvedEdge {
	root: string;
	subpath?: string;
	absolutePath?: string;
}

function resolveWorkspaceEdge(
	specifier: string,
	fromFile: string,
	root: string,
	packages: ReadonlyMap<string, WorkspacePackage>,
): ResolvedEdge | undefined {
	if (specifier.startsWith(".")) {
		const target = resolve(dirname(fromFile), specifier);
		for (const pkg of packages.values()) {
			const modulePath = join(root, pkg.root);
			if (target === modulePath || target.startsWith(`${modulePath}${sep}`)) {
				return { root: pkg.root, absolutePath: target };
			}
		}
		return undefined;
	}
	for (const [name, pkg] of packages) {
		if (specifier === name) return { root: pkg.root, subpath: "." };
		if (specifier.startsWith(`${name}/`)) {
			return { root: pkg.root, subpath: `./${specifier.slice(name.length + 1)}` };
		}
	}
	return undefined;
}

function entryTarget(entry: ModuleRuleAllowed): string {
	return typeof entry === "string" ? entry : entry.target;
}

function allowsTarget(rule: ModuleRule, target: string): boolean {
	return target === rule.root || rule.allowed.some((entry) => entryTarget(entry) === target);
}

function allowedEdge(
	rule: ModuleRule,
	target: string,
	subpath: string | undefined,
	typeOnly: boolean,
	fileRel: string,
): boolean {
	if (target === rule.root) return true;
	return rule.allowed.some((entry) => {
		if (typeof entry === "string") return entry === target;
		if (entry.target !== target) return false;
		if (entry.subpath !== undefined && entry.subpath !== subpath) return false;
		if (entry.typesOnly === true && !typeOnly) return false;
		if (entry.from !== undefined && fileRel !== entry.from && !fileRel.startsWith(`${entry.from}/`))
			return false;
		return true;
	});
}

function internalViolation(
	rule: ModuleRule,
	modulePath: string,
	filePath: string,
	resolved: ResolvedEdge,
): string | undefined {
	if (rule.internal === undefined) return undefined;
	const targetRel =
		resolved.absolutePath !== undefined
			? normalized(relative(modulePath, resolved.absolutePath))
			: resolved.subpath === undefined
				? undefined
				: resolved.subpath === "."
					? ""
					: resolved.subpath.replace(/^\.\//, "");
	if (targetRel === undefined) return undefined;
	const fileRel = normalized(relative(modulePath, filePath));
	for (const { from, forbid } of rule.internal) {
		if (fileRel !== from && !fileRel.startsWith(`${from}/`)) continue;
		for (const dir of forbid) {
			if (targetRel === dir || targetRel.startsWith(`${dir}/`)) {
				return `${rule.root}/${from} may not reach ${rule.root}/${dir}`;
			}
		}
	}
	return undefined;
}

function ruleEntryViolations(packages: ReadonlyMap<string, WorkspacePackage>): string[] {
	const rootsByName = new Map(
		[...packages].map(([name, pkg]) => [pkg.root, { name, pkg }] as const),
	);
	const violations: string[] = [];
	for (const rule of MODULE_RULES) {
		for (const entry of rule.allowed) {
			if (typeof entry === "string" || entry.subpath === undefined) continue;
			const found = rootsByName.get(entry.target);
			if (found === undefined) continue;
			if (found.pkg.exports.size > 0 && !found.pkg.exports.has(entry.subpath)) {
				violations.push(
					`${rule.root}: allowed entry ${JSON.stringify(entry)} names a subpath ${found.name} does not export`,
				);
			}
		}
	}
	return violations;
}

export async function moduleBoundaryViolations(root: string): Promise<string[]> {
	const absoluteRoot = resolve(root);
	const packages = workspacePackages(absoluteRoot);
	const violations: string[] = ruleEntryViolations(packages);
	const scans: { rule: ModuleRule; files: string[] }[] = [];
	for (const rule of MODULE_RULES) {
		const modulePath = join(absoluteRoot, rule.root);
		const manifestPath = join(modulePath, "package.json");
		if (!existsSync(manifestPath)) {
			violations.push(`${rule.root}/package.json is missing`);
			continue;
		}
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
		for (const section of DEPENDENCY_SECTIONS) {
			for (const dependency of Object.keys(manifest[section] ?? {})) {
				const target = packages.get(dependency);
				if (target && !allowsTarget(rule, target.root)) {
					violations.push(
						`${rule.root}/package.json: ${section}.${dependency} creates forbidden ${rule.root} -> ${target.root} edge`,
					);
				}
			}
		}
		scans.push({ rule, files: sourceFiles(modulePath) });
	}
	await parseFiles(
		absoluteRoot,
		scans.flatMap((scan) => scan.files),
		async (parsed) => {
			for (const { rule, files } of scans) {
				const modulePath = join(absoluteRoot, rule.root);
				for (const path of files) {
					for (const { specifier, typeOnly } of importSpecifiers(await parsed(path))) {
						const resolved = resolveWorkspaceEdge(specifier, path, absoluteRoot, packages);
						if (resolved === undefined) continue;
						if (resolved.root === rule.root) {
							const internal = internalViolation(rule, modulePath, path, resolved);
							if (internal !== undefined) {
								violations.push(
									`${normalized(relative(absoluteRoot, path))}: import ${JSON.stringify(specifier)} — ${internal}`,
								);
							}
							continue;
						}
						const fileRel = normalized(relative(modulePath, path));
						if (!allowedEdge(rule, resolved.root, resolved.subpath, typeOnly, fileRel)) {
							violations.push(
								`${normalized(relative(absoluteRoot, path))}: import ${JSON.stringify(specifier)} creates forbidden ${rule.root} -> ${resolved.root} edge`,
							);
						}
					}
				}
			}
		},
	);
	return violations.sort();
}

if (import.meta.main) {
	const root = join(import.meta.dir, "..");
	const violations = await moduleBoundaryViolations(root);
	if (violations.length > 0) {
		console.error("Module boundary violations:");
		for (const violation of violations) console.error(`  - ${violation}`);
		process.exit(1);
	}
	console.log(`check-module-boundaries: OK (${MODULE_RULES.length} module boundaries enforced)`);
}
