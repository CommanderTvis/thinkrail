#!/usr/bin/env bun

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import ts from "typescript";

export interface SourceUnit {
	readonly path: string;
	readonly source: string;
}

export interface ImportSite {
	readonly specifier: string;
	readonly line: number;
}

interface Rule {
	readonly owns: (file: string) => boolean;
	readonly forbids: (specifier: string, file: string) => boolean;
	readonly reason: string;
}

const SCANNED_ROOTS = ["apps", "packages"];
const SKIPPED_DIRS = new Set(["node_modules", "dist", "build", "out", "coverage"]);
const SOURCE_EXTENSIONS = [".ts", ".tsx"];

const PI_SIDE_PACKAGES: { readonly [dir: string]: string } = {
	"packages/pi-agent": "the first-party ACP agent wrapping pi — the one host-side pi importer",
	"packages/pi-delegation":
		"portable pure-pi delegation core — child sessions from sessions, inside pi itself",
	"packages/pi-subagents": "portable pi extension — the Agent tools ship into pi itself",
	"packages/pi-thinkrail-workflow":
		"portable pi extension — the workflow skills ship into pi itself",
	"packages/pi-todos": "portable pi extension — the todo_* tools ship into pi itself",
	"packages/pi-visualize": "portable pi extension — the visualize tool ships into pi itself",
	"packages/spec-graph": "portable pi extension — the spec_* tools ship into pi itself",
};

const PI_IMPORT_EXEMPTIONS: { readonly [path: string]: string } = {};

const ACP_SDK_CLIENT_SIDE = [
	"packages/acp/src/capabilities",
	"packages/acp/src/client",
	"packages/acp/src/connection",
	"packages/acp/src/testing",
	"packages/acp/src/translate",
];

const ACP_SDK_AGENT_SIDE = ["packages/pi-agent"];

function under(file: string, path: string): boolean {
	return file === path || file.startsWith(`${path}/`);
}

function underAny(file: string, paths: readonly string[]): boolean {
	return paths.some((path) => under(file, path));
}

function isPackage(specifier: string, name: string): boolean {
	return specifier === name || specifier.startsWith(`${name}/`);
}

function isPiPackage(specifier: string): boolean {
	return specifier.startsWith("@earendil-works/");
}

function isAcpSdk(specifier: string): boolean {
	return specifier.startsWith("@agentclientprotocol/");
}

function isTestRunnerImport(file: string, specifier: string): boolean {
	if (!/\.test\.tsx?$/.test(file)) return false;
	return specifier === "bun:test" || specifier.startsWith("node:");
}

function rulesFor(piExemptions: { readonly [path: string]: string }): readonly Rule[] {
	return [
		{
			owns: (file) => under(file, "packages/contracts"),
			forbids: (specifier, file) => !isTestRunnerImport(file, specifier),
			reason:
				"packages/contracts imports nothing — no workspace package, no npm package, no node builtin",
		},
		{
			owns: (file) => under(file, "packages/acp/src/meta"),
			forbids: (specifier, file) => !isTestRunnerImport(file, specifier),
			reason:
				"packages/acp/src/meta stays dependency-free so packages/pi-agent can import it " +
				"without inheriting a graph",
		},
		{
			owns: (file) => under(file, "packages/acp"),
			forbids: (specifier) => isPackage(specifier, "@thinkrail/server"),
			reason:
				"packages/acp reaches the host only through injected delegates, never a @thinkrail/server import",
		},
		{
			owns: (file) => under(file, "apps/web"),
			forbids: (specifier) =>
				isPiPackage(specifier) ||
				["@thinkrail/server", "@thinkrail/shared", "@thinkrail/acp"].some((name) =>
					isPackage(specifier, name),
				),
			reason:
				"apps/web ships without a host — @thinkrail/contracts is the only workspace package it may import",
		},
		{
			owns: (file) => !underAny(file, [...ACP_SDK_CLIENT_SIDE, ...ACP_SDK_AGENT_SIDE]),
			forbids: isAcpSdk,
			reason:
				`only ${ACP_SDK_CLIENT_SIDE.join(", ")} may import the ACP SDK on the client side, ` +
				`and ${ACP_SDK_AGENT_SIDE.join(", ")} on the agent side`,
		},
		{
			owns: (file) =>
				!underAny(file, Object.keys(PI_SIDE_PACKAGES)) &&
				!underAny(file, Object.keys(piExemptions)),
			forbids: isPiPackage,
			reason:
				"only packages/pi-agent and the portable pi extensions may import a pi package " +
				"(value or type, any subpath)",
		},
	];
}

const RULES_NARROWEST_FIRST = rulesFor(PI_IMPORT_EXEMPTIONS);

export function importsOf(unit: SourceUnit): ImportSite[] {
	const sourceFile = ts.createSourceFile(
		unit.path,
		unit.source,
		ts.ScriptTarget.Latest,
		false,
		unit.path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
	const sites: ImportSite[] = [];
	const record = (node: ts.Node, specifier: ts.Node | undefined): void => {
		if (specifier === undefined) return;
		if (!ts.isStringLiteral(specifier) && !ts.isNoSubstitutionTemplateLiteral(specifier)) return;
		const at = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
		sites.push({ specifier: specifier.text, line: at.line + 1 });
	};
	const visit = (node: ts.Node): void => {
		if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
			record(node, node.moduleSpecifier);
		} else if (
			ts.isImportEqualsDeclaration(node) &&
			ts.isExternalModuleReference(node.moduleReference)
		) {
			record(node, node.moduleReference.expression);
		} else if (ts.isCallExpression(node)) {
			const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
			const required = ts.isIdentifier(node.expression) && node.expression.text === "require";
			if (dynamic || required) record(node, node.arguments[0]);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return sites;
}

export function violationsIn(
	units: readonly SourceUnit[],
	piExemptions?: { readonly [path: string]: string },
): string[] {
	const rules = piExemptions === undefined ? RULES_NARROWEST_FIRST : rulesFor(piExemptions);
	const violations: string[] = [];
	for (const unit of units) {
		for (const site of importsOf(unit)) {
			if (site.specifier.startsWith(".")) continue;
			const rule = rules.find(
				(candidate) => candidate.owns(unit.path) && candidate.forbids(site.specifier, unit.path),
			);
			if (rule === undefined) continue;
			violations.push(`${unit.path}:${site.line}: imports "${site.specifier}" — ${rule.reason}`);
		}
	}
	return violations;
}

export function exemptedPiImports(
	units: readonly SourceUnit[],
	piExemptions: { readonly [path: string]: string } = PI_IMPORT_EXEMPTIONS,
): Map<string, number> {
	const exemptions = Object.keys(piExemptions);
	const counts = new Map<string, number>(exemptions.map((path): [string, number] => [path, 0]));
	for (const unit of units) {
		const exemption = exemptions.find((path) => under(unit.path, path));
		if (exemption === undefined) continue;
		const pi = importsOf(unit).filter((site) => isPiPackage(site.specifier)).length;
		counts.set(exemption, (counts.get(exemption) ?? 0) + pi);
	}
	return counts;
}

export function sourceUnits(root: string, dir: string): SourceUnit[] {
	const units: SourceUnit[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name.startsWith(".") || SKIPPED_DIRS.has(entry.name)) continue;
			units.push(...sourceUnits(root, path));
			continue;
		}
		if (!SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) continue;
		units.push({
			path: relative(root, path).split(sep).join("/"),
			source: readFileSync(path, "utf8"),
		});
	}
	return units;
}

if (import.meta.main) {
	const root = resolve(import.meta.dir, "..");
	const units = SCANNED_ROOTS.flatMap((scanned) => sourceUnits(root, join(root, scanned)));
	const violations = violationsIn(units);
	const exempted = exemptedPiImports(units);
	const stale = [...exempted].filter(([, count]) => count === 0).map(([path]) => path);

	if (violations.length > 0) {
		console.error("check-architecture: import(s) crossing a boundary the specs forbid:");
		for (const violation of violations) console.error(`  - ${violation}`);
		console.error(
			"\nFix the import. If the boundary itself is meant to move, update the owning SPEC.md first,",
		);
		console.error("then the rule table in scripts/check-architecture.ts.");
	}
	if (stale.length > 0) {
		console.error(
			"check-architecture: stale pi exemption(s) — nothing under these paths imports pi any more:",
		);
		for (const path of stale) console.error(`  - ${path}  (${PI_IMPORT_EXEMPTIONS[path]})`);
		console.error("\nDelete the entry from PI_IMPORT_EXEMPTIONS in scripts/check-architecture.ts.");
	}
	if (violations.length > 0 || stale.length > 0) process.exit(1);

	const pending = [...exempted.values()].reduce((total, count) => total + count, 0);
	console.log(
		`check-architecture: OK (${RULES_NARROWEST_FIRST.length} boundary rules over ${units.length} ` +
			`source files in ${SCANNED_ROOTS.map((scanned) => `${scanned}/*`).join(", ")}; ${pending} pi ` +
			`imports still exempt under ${exempted.size} paths pending the packages/pi-agent move)`,
	);
}
