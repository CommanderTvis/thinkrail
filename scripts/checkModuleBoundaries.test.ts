import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleBoundaryViolations } from "./check-module-boundaries";

const roots: string[] = [];

const modules = {
	"packages/artifact-tests": "@thinkrail/artifact-tests",
	"packages/contracts": "@thinkrail/contracts",
	"packages/plugin-api": "@thinkrail/plugin-api",
	"packages/plugin-branch-graph": "@thinkrail/plugin-branch-graph",
	"packages/plugin-blueprint": "@thinkrail/plugin-blueprint",
	"packages/plugin-claude-code": "@thinkrail/plugin-claude-code",
	"packages/plugin-codex": "@thinkrail/plugin-codex",
	"packages/plugin-discord": "@thinkrail/plugin-discord",
	"packages/plugin-file-icons": "@thinkrail/plugin-file-icons",
	"packages/plugin-pdf-preview": "@thinkrail/plugin-pdf-preview",
	"packages/plugin-spec-dialect": "@thinkrail/plugin-spec-dialect",
	"packages/plugin-visualize": "@thinkrail/plugin-visualize",
	"packages/plugin-ui": "@thinkrail/plugin-ui",
	"packages/shared": "@thinkrail/shared",
	"packages/pi-delegation": "pi-delegation",
	"packages/pi-subagents": "pi-subagents",
	"packages/server": "@thinkrail/server",
	"apps/web": "@thinkrail/web",
	"apps/cli": "@thinkrail/cli",
	"apps/desktop": "@thinkrail/desktop",
} as const;

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(root: string, path: string, content: string): void {
	const target = join(root, path);
	mkdirSync(join(target, ".."), { recursive: true });
	writeFileSync(target, content);
}

function fixture(): string {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-module-boundaries-"));
	roots.push(root);
	const dependencies: Record<string, Record<string, string>> = {
		"packages/artifact-tests": {
			"@thinkrail/cli": "workspace:*",
			"@thinkrail/server": "workspace:*",
			"@thinkrail/shared": "workspace:*",
		},
		"packages/shared": { "@thinkrail/contracts": "workspace:*" },
		"packages/pi-subagents": { "pi-delegation": "workspace:*" },
		"packages/plugin-spec-dialect": {
			"@thinkrail/plugin-api": "workspace:*",
			"@thinkrail/contracts": "workspace:*",
		},
		"packages/plugin-branch-graph": {
			"@thinkrail/plugin-api": "workspace:*",
			"@thinkrail/contracts": "workspace:*",
			"@thinkrail/plugin-ui": "workspace:*",
		},
		"packages/plugin-blueprint": {
			"@thinkrail/plugin-api": "workspace:*",
			"@thinkrail/contracts": "workspace:*",
			"@thinkrail/plugin-spec-dialect": "workspace:*",
		},
		"packages/plugin-claude-code": {
			"@thinkrail/plugin-api": "workspace:*",
			"@thinkrail/contracts": "workspace:*",
			"@thinkrail/shared": "workspace:*",
		},
		"packages/plugin-codex": {
			"@thinkrail/plugin-api": "workspace:*",
			"@thinkrail/contracts": "workspace:*",
			"@thinkrail/plugin-ui": "workspace:*",
		},
		"packages/plugin-pdf-preview": {
			"@thinkrail/plugin-api": "workspace:*",
			"@thinkrail/contracts": "workspace:*",
			"@thinkrail/plugin-ui": "workspace:*",
		},
		"packages/plugin-discord": {
			"@thinkrail/plugin-api": "workspace:*",
			"@thinkrail/contracts": "workspace:*",
			"@thinkrail/shared": "workspace:*",
			"@thinkrail/plugin-ui": "workspace:*",
		},
		"packages/plugin-file-icons": {
			"@thinkrail/plugin-api": "workspace:*",
			"@thinkrail/contracts": "workspace:*",
			"@thinkrail/plugin-ui": "workspace:*",
		},
		"packages/plugin-visualize": {
			"@thinkrail/plugin-api": "workspace:*",
			"@thinkrail/contracts": "workspace:*",
			"@thinkrail/shared": "workspace:*",
			"@thinkrail/plugin-ui": "workspace:*",
		},
		"packages/server": {
			"@thinkrail/contracts": "workspace:*",
			"@thinkrail/shared": "workspace:*",
			"@thinkrail/plugin-spec-dialect": "workspace:*",
			"@thinkrail/plugin-blueprint": "workspace:*",
			"@thinkrail/plugin-claude-code": "workspace:*",
			"@thinkrail/plugin-pdf-preview": "workspace:*",
			"@thinkrail/plugin-file-icons": "workspace:*",
			"@thinkrail/plugin-discord": "workspace:*",
			"@thinkrail/plugin-visualize": "workspace:*",
			"@thinkrail/plugin-branch-graph": "workspace:*",
			"pi-delegation": "workspace:*",
			"pi-subagents": "workspace:*",
		},
		"apps/web": {
			"@thinkrail/contracts": "workspace:*",
			"@thinkrail/plugin-spec-dialect": "workspace:*",
			"@thinkrail/plugin-blueprint": "workspace:*",
			"@thinkrail/plugin-claude-code": "workspace:*",
			"@thinkrail/plugin-pdf-preview": "workspace:*",
			"@thinkrail/plugin-file-icons": "workspace:*",
			"@thinkrail/plugin-discord": "workspace:*",
			"@thinkrail/plugin-visualize": "workspace:*",
			"@thinkrail/plugin-branch-graph": "workspace:*",
		},
		"apps/cli": {
			"@thinkrail/server": "workspace:*",
			"@thinkrail/shared": "workspace:*",
		},
		"apps/desktop": {
			"@thinkrail/server": "workspace:*",
			"@thinkrail/shared": "workspace:*",
		},
	};
	for (const [moduleRoot, name] of Object.entries(modules)) {
		write(
			root,
			`${moduleRoot}/package.json`,
			JSON.stringify({ name, dependencies: dependencies[moduleRoot] ?? {} }),
		);
	}
	return root;
}

test("accepts the declared package rings and thin launcher edges", async () => {
	const root = fixture();
	write(
		root,
		"packages/shared/src/value.ts",
		'import type { Project } from "@thinkrail/contracts";',
	);
	write(root, "packages/pi-subagents/src/value.ts", 'export * from "pi-delegation";');
	write(
		root,
		"packages/server/src/value.ts",
		'import "pi-delegation"; import "pi-subagents"; export * from "@thinkrail/contracts";',
	);
	write(root, "apps/web/src/value.tsx", 'import type { Project } from "@thinkrail/contracts";');
	write(root, "apps/cli/src/value.ts", 'import { bootHost } from "@thinkrail/server";');
	write(
		root,
		"packages/artifact-tests/src/value.ts",
		'import "@thinkrail/server/history-test-fixtures"; import "@thinkrail/cli/artifact";',
	);
	write(
		root,
		"apps/desktop/src/value.ts",
		'const host = import("@thinkrail/server/build-support");',
	);

	expect(await moduleBoundaryViolations(root)).toEqual([]);
});

test("keeps artifact test infrastructure out of product code", async () => {
	const root = fixture();
	write(root, "apps/desktop/src/testLeak.ts", 'import "@thinkrail/artifact-tests";');
	write(root, "packages/server/src/testLeak.ts", 'import "@thinkrail/artifact-tests";');
	write(root, "packages/artifact-tests/src/webLeak.ts", 'import "@thinkrail/web";');
	expect(await moduleBoundaryViolations(root)).toEqual([
		'apps/desktop/src/testLeak.ts: import "@thinkrail/artifact-tests" creates forbidden apps/desktop -> packages/artifact-tests edge',
		'packages/artifact-tests/src/webLeak.ts: import "@thinkrail/web" creates forbidden packages/artifact-tests -> apps/web edge',
		'packages/server/src/testLeak.ts: import "@thinkrail/artifact-tests" creates forbidden packages/server -> packages/artifact-tests edge',
	]);
});

test("ignores generated framework files without excluding desktop source", async () => {
	const root = fixture();
	write(root, "apps/desktop/.hutch/devkit/api/example.ts", 'import "@thinkrail/web";');
	write(root, "apps/desktop/.cottontail-tmp/loader.mjs", 'import "@thinkrail/web";');
	write(root, "apps/desktop/src/example.ts", 'import "@thinkrail/web";');

	expect(await moduleBoundaryViolations(root)).toEqual([
		'apps/desktop/src/example.ts: import "@thinkrail/web" creates forbidden apps/desktop -> apps/web edge',
	]);
});

test("rejects manifest, type-only, dynamic, CommonJS, and relative cross-boundary edges", async () => {
	const root = fixture();
	write(
		root,
		"apps/desktop/package.json",
		JSON.stringify({
			name: "@thinkrail/desktop",
			dependencies: {
				"@thinkrail/server": "workspace:*",
				"@thinkrail/shared": "workspace:*",
				"@thinkrail/web": "workspace:*",
			},
		}),
	);
	write(
		root,
		"apps/web/src/typeLeak.ts",
		'import type { RunningServer } from "@thinkrail/server";',
	);
	write(root, "apps/web/src/commonJsLeak.cjs", 'require("@thinkrail/server");');
	write(root, "apps/cli/src/dynamicLeak.ts", 'void import("@thinkrail/web");');
	write(root, "packages/shared/src/relativeLeak.ts", 'export * from "../../server/src/index";');
	write(root, "packages/pi-delegation/src/leak.ts", 'import "pi-subagents";');

	expect(await moduleBoundaryViolations(root)).toEqual([
		'apps/cli/src/dynamicLeak.ts: import "@thinkrail/web" creates forbidden apps/cli -> apps/web edge',
		"apps/desktop/package.json: dependencies.@thinkrail/web creates forbidden apps/desktop -> apps/web edge",
		'apps/web/src/commonJsLeak.cjs: import "@thinkrail/server" creates forbidden apps/web -> packages/server edge',
		'apps/web/src/typeLeak.ts: import "@thinkrail/server" creates forbidden apps/web -> packages/server edge',
		'packages/pi-delegation/src/leak.ts: import "pi-subagents" creates forbidden packages/pi-delegation -> packages/pi-subagents edge',
		'packages/shared/src/relativeLeak.ts: import "../../server/src/index" creates forbidden packages/shared -> packages/server edge',
	]);
});

test("narrows a package edge to one subpath, ignoring the package's other subpaths", async () => {
	const root = fixture();
	write(
		root,
		"packages/plugin-blueprint/host/allowed.ts",
		'import type { X } from "@thinkrail/plugin-spec-dialect/contracts";',
	);
	write(
		root,
		"packages/plugin-blueprint/host/leak.ts",
		'import "@thinkrail/plugin-spec-dialect/web";',
	);
	write(
		root,
		"packages/plugin-blueprint/host/bareLeak.ts",
		'import "@thinkrail/plugin-spec-dialect";',
	);

	expect(await moduleBoundaryViolations(root)).toEqual([
		'packages/plugin-blueprint/host/bareLeak.ts: import "@thinkrail/plugin-spec-dialect" creates forbidden packages/plugin-blueprint -> packages/plugin-spec-dialect edge',
		'packages/plugin-blueprint/host/leak.ts: import "@thinkrail/plugin-spec-dialect/web" creates forbidden packages/plugin-blueprint -> packages/plugin-spec-dialect edge',
	]);
});

test("accepts a type-only subpath edge but rejects the same subpath as a value import", async () => {
	const root = fixture();
	write(
		root,
		"apps/web/src/types.ts",
		'import type { X } from "@thinkrail/plugin-blueprint/contracts";',
	);
	write(
		root,
		"apps/web/src/value.ts",
		'import { X } from "@thinkrail/plugin-blueprint/contracts";',
	);

	expect(await moduleBoundaryViolations(root)).toEqual([
		'apps/web/src/value.ts: import "@thinkrail/plugin-blueprint/contracts" creates forbidden apps/web -> packages/plugin-blueprint edge',
	]);
});

test("lets a plugin's host half take a value edge into another plugin's contracts, but keeps its web half to types only", async () => {
	const root = fixture();
	write(
		root,
		"packages/plugin-blueprint/host/index.ts",
		'import { specDialectContract } from "@thinkrail/plugin-spec-dialect/contracts";\nconsole.log(specDialectContract);',
	);
	write(
		root,
		"packages/plugin-blueprint/web/typeLeak.ts",
		'import type { X } from "@thinkrail/plugin-spec-dialect/contracts";',
	);
	write(
		root,
		"packages/plugin-blueprint/web/valueLeak.ts",
		'import { specDialectContract } from "@thinkrail/plugin-spec-dialect/contracts";',
	);

	expect(await moduleBoundaryViolations(root)).toEqual([
		'packages/plugin-blueprint/web/valueLeak.ts: import "@thinkrail/plugin-spec-dialect/contracts" creates forbidden packages/plugin-blueprint -> packages/plugin-spec-dialect edge',
	]);
});

test("recognizes a per-specifier `import { type X }` as type-only", async () => {
	const root = fixture();
	write(
		root,
		"apps/web/src/inlineType.ts",
		'import { type X } from "@thinkrail/plugin-blueprint/contracts";',
	);
	write(
		root,
		"apps/web/src/inlineMixed.ts",
		'import { type X, value } from "@thinkrail/plugin-blueprint/contracts";',
	);

	expect(await moduleBoundaryViolations(root)).toEqual([
		'apps/web/src/inlineMixed.ts: import "@thinkrail/plugin-blueprint/contracts" creates forbidden apps/web -> packages/plugin-blueprint edge',
	]);
});

test("keeps a plugin's web half out of its own host half, but not the reverse", async () => {
	const root = fixture();
	write(root, "packages/plugin-blueprint/web/index.ts", 'import { activate } from "../host";');
	write(root, "packages/plugin-blueprint/host/index.ts", 'import "../web";');

	expect(await moduleBoundaryViolations(root)).toEqual([
		'packages/plugin-blueprint/web/index.ts: import "../host" — packages/plugin-blueprint/web may not reach packages/plugin-blueprint/host',
	]);
});
