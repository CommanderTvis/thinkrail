import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { WsMethod, WsMethodName } from "./wsProtocol";
import { WS_CHANNELS, WS_METHODS } from "./wsProtocol";

const SRC = resolve(new URL(".", import.meta.url).pathname);
const PACKAGE_JSON = resolve(SRC, "..", "package.json");

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...sourceFiles(path));
		else if (entry.name.endsWith(".ts")) out.push(path);
	}
	return out;
}

function code(path: string): string {
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
	isTest: boolean;
	specifier: string;
	internal: boolean;
}

function reaches(path: string): Reach[] {
	const text = code(path);
	const file = relative(SRC, path);
	const isTest = path.endsWith(".test.ts");
	const out: Reach[] = [];
	for (const pattern of [STATIC_FROM, SIDE_EFFECT, DYNAMIC, REQUIRE]) {
		for (const match of text.matchAll(pattern)) {
			const specifier = match[1];
			if (specifier === undefined) continue;
			const landed = specifier.startsWith(".")
				? relative(SRC, resolve(dirname(path), specifier))
				: null;
			const internal =
				landed !== null && landed !== "" && landed !== ".." && !landed.startsWith(`..${sep}`);
			out.push({ file, isTest, specifier, internal });
		}
	}
	return out;
}

const FILES = sourceFiles(SRC);
const SOURCES = FILES.filter((path) => !path.endsWith(".test.ts"));
const REACHES = FILES.flatMap(reaches);

interface Manifest {
	dependencies?: { readonly [name: string]: string };
	devDependencies?: { readonly [name: string]: string };
	peerDependencies?: { readonly [name: string]: string };
	optionalDependencies?: { readonly [name: string]: string };
}

const MANIFEST = JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as Manifest;

describe("the import scan sees the real wire", () => {
	it("covers every module the barrel re-exports", () => {
		expect(SOURCES.map((path) => relative(SRC, path)).sort()).toEqual([
			"chatProtocol.ts",
			"domain.ts",
			"index.ts",
			"wsProtocol.ts",
		]);
		expect(REACHES.filter((reach) => reach.file === "index.ts").length).toBeGreaterThan(0);
	});
});

describe("@thinkrail/contracts imports nothing", () => {
	it("has no specifier that leaves the package, type-only or otherwise", () => {
		expect(
			REACHES.filter((reach) => !reach.isTest && !reach.internal).map(
				(reach) => `${reach.file} -> ${reach.specifier}`,
			),
		).toEqual([]);
	});

	it("lets its own test reach only the runner and the disk it reads", () => {
		expect(
			REACHES.filter(
				(reach) =>
					reach.isTest &&
					!reach.internal &&
					reach.specifier !== "bun:test" &&
					!reach.specifier.startsWith("node:"),
			).map((reach) => `${reach.file} -> ${reach.specifier}`),
		).toEqual([]);
	});

	it("declares no dependency and nothing beyond the toolchain in devDependencies", () => {
		expect(MANIFEST.dependencies).toBeUndefined();
		expect(MANIFEST.peerDependencies).toBeUndefined();
		expect(MANIFEST.optionalDependencies).toBeUndefined();
		expect(Object.keys(MANIFEST.devDependencies ?? {}).sort()).toEqual([
			"@types/bun",
			"typescript",
		]);
	});

	it("names no host runtime, which is the door @types/bun would otherwise open", () => {
		const runtime = /\bBun\b|\bprocess\b|\brequire\b|\b__dirname\b|\b__filename\b|import\.meta/;
		expect(
			SOURCES.filter((path) => runtime.test(code(path))).map((path) => relative(SRC, path)),
		).toEqual([]);
	});
});

type SameMembers<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const METHOD_TABLE_COMPLETE: SameMembers<WsMethod, WsMethodName> = true;

describe("the wire method table is complete", () => {
	it("pairs every WS_METHODS entry with a WsMethodMap row", () => {
		expect(METHOD_TABLE_COMPLETE).toBe(true);
	});

	it("mints a distinct string for every method and every channel", () => {
		const names = [...Object.values(WS_METHODS), ...Object.values(WS_CHANNELS)];
		expect(new Set(names).size).toBe(names.length);
	});
});
