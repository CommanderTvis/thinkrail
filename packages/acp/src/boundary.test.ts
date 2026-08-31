import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const SRC = resolve(new URL(".", import.meta.url).pathname);
const PACKAGE_JSON = resolve(SRC, "..", "package.json");

const SUBMODULES = new Set(
	readdirSync(SRC, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name),
);

const ALLOWED_EDGES: { readonly [owner: string]: readonly string[] } = {
	capabilities: ["meta", "translate"],
	client: ["translate"],
	connection: ["capabilities", "client", "meta", "translate"],
	meta: [],
	registry: ["capabilities", "connection"],
	testing: ["connection", "translate"],
	translate: ["meta"],
};

const ALLOWED_PACKAGES: { readonly [owner: string]: readonly string[] } = {
	capabilities: ["@agentclientprotocol/sdk", "@thinkrail/contracts"],
	client: ["@agentclientprotocol/sdk", "@thinkrail/contracts"],
	connection: ["@agentclientprotocol/sdk", "@thinkrail/contracts"],
	meta: [],
	registry: ["@thinkrail/contracts"],
	testing: [
		"@agentclientprotocol/sdk",
		"@agentclientprotocol/sdk/schema/schema.json",
		"@thinkrail/contracts",
		"ajv/dist/2020",
	],
	translate: ["@agentclientprotocol/sdk", "@thinkrail/contracts"],
};

const TEST_ONLY_EDGES: { readonly [owner: string]: readonly string[] } = {
	translate: ["testing"],
};

const ROOT_PACKAGES: readonly string[] = ["@thinkrail/contracts"];

const ACP_FACING = new Set(["capabilities", "client", "connection", "testing", "translate"]);

const DEVELOPMENT_ONLY = "testing";

const SANCTIONED_INTERNALS = new Set([`capabilities -> translate${sep}guards`]);

const NODE_BUILTIN_OWNERS = new Set(["registry", "testing"]);

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...sourceFiles(path));
		else if (entry.name.endsWith(".ts")) out.push(path);
	}
	return out;
}

function codeWithoutComments(path: string): string {
	return readFileSync(path, "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^[ \t]*\/\/.*$/gm, "");
}

const STATIC_FROM = /(?:^|\n)[ \t]*(?:import|export)\b[^;]*?\bfrom[ \t]*["']([^"']+)["']/g;
const SIDE_EFFECT = /(?:^|\n)[ \t]*import[ \t]*["']([^"']+)["']/g;
const DYNAMIC = /\bimport[ \t]*\([ \t]*["']([^"']+)["']/g;
const REQUIRE = /\brequire[ \t]*\([ \t]*["']([^"']+)["']/g;

interface Reach {
	file: string;
	owner: string | null;
	isTest: boolean;
	specifier: string;
	target: string | null;
	escapes: boolean;
}

function reaches(path: string): Reach[] {
	const text = codeWithoutComments(path);
	const file = relative(SRC, path);
	const parts = file.split(sep);
	const head = parts[0] ?? "";
	const owner = parts.length > 1 && SUBMODULES.has(head) ? head : null;
	const isTest = path.endsWith(".test.ts");
	const out: Reach[] = [];
	for (const pattern of [STATIC_FROM, SIDE_EFFECT, DYNAMIC, REQUIRE]) {
		for (const match of text.matchAll(pattern)) {
			const specifier = match[1];
			if (specifier === undefined) continue;
			if (!specifier.startsWith(".")) {
				out.push({ file, owner, isTest, specifier, target: null, escapes: false });
				continue;
			}
			const landed = relative(SRC, resolve(dirname(path), specifier));
			const escapes = landed === "" || landed === ".." || landed.startsWith(`..${sep}`);
			out.push({ file, owner, isTest, specifier, target: escapes ? null : landed, escapes });
		}
	}
	return out;
}

function landing(target: string): { submodule: string | null; barrel: boolean } {
	const parts = target.split(sep);
	const head = parts[0] ?? "";
	if (!SUBMODULES.has(head)) return { submodule: null, barrel: false };
	return { submodule: head, barrel: parts.length === 1 };
}

const FILES = sourceFiles(SRC);
const REACHES = FILES.flatMap(reaches);
const SOURCE_REACHES = REACHES.filter((reach) => !reach.isTest);

interface Manifest {
	dependencies?: { readonly [name: string]: string };
	devDependencies?: { readonly [name: string]: string };
	peerDependencies?: { readonly [name: string]: string };
	optionalDependencies?: { readonly [name: string]: string };
}

const MANIFEST = JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as Manifest;

describe("the import scan sees the real graph", () => {
	it("finds every source file and at least one import in each barrel", () => {
		expect(FILES.length).toBeGreaterThan(20);
		expect(SUBMODULES).toEqual(
			new Set(["capabilities", "client", "connection", "meta", "registry", "testing", "translate"]),
		);
		expect(REACHES.filter((reach) => reach.file === "index.ts").length).toBeGreaterThan(0);
	});
});

describe("packages/acp reaches nothing outside itself", () => {
	it("names no host, sibling app or agent package", () => {
		const forbidden = /^(@thinkrail\/(server|shared|web)|@earendil-works\/|pi-|bun-pty)/;
		expect(
			REACHES.filter((reach) => forbidden.test(reach.specifier)).map(
				(reach) => `${reach.file} -> ${reach.specifier}`,
			),
		).toEqual([]);
	});

	it("has no relative specifier that climbs out of src/", () => {
		expect(
			REACHES.filter((reach) => reach.escapes).map(
				(reach) => `${reach.file} -> ${reach.specifier}`,
			),
		).toEqual([]);
	});

	it("declares only the dependencies SPEC.md admits", () => {
		expect(Object.keys(MANIFEST.dependencies ?? {}).sort()).toEqual([
			"@agentclientprotocol/sdk",
			"@thinkrail/contracts",
			"zod",
		]);
		expect(Object.keys(MANIFEST.devDependencies ?? {}).sort()).toEqual([
			"@types/bun",
			"ajv",
			"typescript",
		]);
		expect(MANIFEST.peerDependencies).toBeUndefined();
		expect(MANIFEST.optionalDependencies).toBeUndefined();
	});
});

describe("the ACP SDK stops at the sub-modules that face the protocol", () => {
	it("is imported nowhere else", () => {
		expect(
			REACHES.filter(
				(reach) =>
					reach.specifier.startsWith("@agentclientprotocol/") &&
					(reach.owner === null || !ACP_FACING.has(reach.owner)),
			).map((reach) => `${reach.file} -> ${reach.specifier}`),
		).toEqual([]);
	});

	it("does not reach the package barrel, which would hand an ACP type to the host", () => {
		const barrel = REACHES.filter((reach) => reach.file === "index.ts");
		expect(barrel.map((reach) => reach.specifier).filter((s) => s.includes("translate"))).toEqual(
			[],
		);
		expect(barrel.map((reach) => reach.specifier).filter((s) => !s.startsWith("."))).toEqual([]);
	});
});

describe("meta stays dependency-free", () => {
	it("imports nothing but its own siblings", () => {
		expect(
			SOURCE_REACHES.filter(
				(reach) => reach.owner === "meta" && landing(reach.target ?? "").submodule !== "meta",
			).map((reach) => `${reach.file} -> ${reach.specifier}`),
		).toEqual([]);
	});

	it("is what packages/pi-agent can import: no workspace package, no SDK, no builtin", () => {
		expect(
			SOURCE_REACHES.filter((reach) => reach.owner === "meta" && reach.target === null).map(
				(reach) => `${reach.file} -> ${reach.specifier}`,
			),
		).toEqual([]);
	});
});

describe("the sub-module graph is the one SPEC.md draws", () => {
	it("has no edge the spec does not list", () => {
		const offenders: string[] = [];
		for (const reach of REACHES) {
			if (reach.target === null || reach.owner === null) continue;
			const { submodule } = landing(reach.target);
			if (submodule === null || submodule === reach.owner) continue;
			const allowed = ALLOWED_EDGES[reach.owner] ?? [];
			const forTests = reach.isTest ? (TEST_ONLY_EDGES[reach.owner] ?? []) : [];
			if (!allowed.includes(submodule) && !forTests.includes(submodule)) {
				offenders.push(`${reach.file} -> ${reach.specifier}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	it("crosses a sibling only through its barrel", () => {
		const offenders: string[] = [];
		for (const reach of REACHES) {
			if (reach.target === null || reach.owner === null) continue;
			const { submodule, barrel } = landing(reach.target);
			if (submodule === null || submodule === reach.owner || barrel) continue;
			if (!SANCTIONED_INTERNALS.has(`${reach.owner} -> ${reach.target}`)) {
				offenders.push(`${reach.owner} -> ${reach.target}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	it("imports only the packages each sub-module's spec admits", () => {
		const offenders: string[] = [];
		for (const reach of REACHES) {
			if (reach.target !== null) continue;
			if (reach.specifier === "bun:test") {
				if (!reach.isTest) offenders.push(`${reach.file} -> ${reach.specifier}`);
				continue;
			}
			if (reach.specifier.startsWith("node:")) {
				const allowed =
					reach.isTest || (reach.owner !== null && NODE_BUILTIN_OWNERS.has(reach.owner));
				if (!allowed) offenders.push(`${reach.file} -> ${reach.specifier}`);
				continue;
			}
			const allowed = reach.owner === null ? ROOT_PACKAGES : (ALLOWED_PACKAGES[reach.owner] ?? []);
			if (!allowed.includes(reach.specifier)) offenders.push(`${reach.file} -> ${reach.specifier}`);
		}
		expect(offenders).toEqual([]);
	});
});

describe("testing is a development surface", () => {
	it("is imported by no source file outside itself, only by tests", () => {
		expect(
			SOURCE_REACHES.filter(
				(reach) =>
					reach.owner !== DEVELOPMENT_ONLY &&
					landing(reach.target ?? "").submodule === DEVELOPMENT_ONLY,
			).map((reach) => `${reach.file} -> ${reach.specifier}`),
		).toEqual([]);
	});

	it("keeps ajv out of every other sub-module, because it is a devDependency", () => {
		expect(
			REACHES.filter(
				(reach) => reach.specifier.startsWith("ajv") && reach.owner !== DEVELOPMENT_ONLY,
			).map((reach) => `${reach.file} -> ${reach.specifier}`),
		).toEqual([]);
	});
});

describe("translate stays pure", () => {
	it("reads no clock, no random source and no process", () => {
		const impure =
			/\bDate\.now\b|\bnew Date\b|\bMath\.random\b|\bcrypto\.|\bperformance\.|\bBun\.|\bprocess\./;
		expect(
			FILES.filter((path) => relative(SRC, path).startsWith(`translate${sep}`))
				.filter((path) => !path.endsWith(".test.ts"))
				.filter((path) => impure.test(codeWithoutComments(path)))
				.map((path) => relative(SRC, path)),
		).toEqual([]);
	});
});
