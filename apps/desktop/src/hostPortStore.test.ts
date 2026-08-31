import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostPortStore } from "./hostPortStore";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function portPath(): string {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-host-ports-"));
	roots.push(root);
	mkdirSync(join(root, "nested"));
	return join(root, "nested", "host-ports.json");
}

test("a profile comes back to the port it listened on, and profiles keep their own", () => {
	const path = portPath();
	const ports = new HostPortStore(path);
	expect(ports.read("local")).toBeUndefined();
	expect(ports.write("local", 51234)).toBe(true);
	expect(ports.write("remote", 51235)).toBe(true);

	const restored = new HostPortStore(path);
	expect(restored.read("local")).toBe(51234);
	expect(restored.read("remote")).toBe(51235);
});

test("only a real port is remembered", () => {
	const path = portPath();
	const ports = new HostPortStore(path);
	expect(ports.write("local", 0)).toBe(false);
	expect(ports.write("local", 80)).toBe(false);
	expect(ports.write("local", 70000)).toBe(false);
	expect(ports.write("local", 51234.5)).toBe(false);
	expect(ports.write("local", "51234")).toBe(false);
	expect(existsSync(path)).toBe(false);
});

test("a corrupt document starts over rather than refusing to boot", () => {
	const path = portPath();
	writeFileSync(path, "{ not json");
	expect(new HostPortStore(path).read("local")).toBeUndefined();

	writeFileSync(path, JSON.stringify({ version: 2, ports: { local: 51234 } }));
	expect(new HostPortStore(path).read("local")).toBeUndefined();

	writeFileSync(path, JSON.stringify({ version: 1, ports: { local: "51234", other: 51235 } }));
	const partial = new HostPortStore(path);
	expect(partial.read("local")).toBeUndefined();
	expect(partial.read("other")).toBe(51235);
});
