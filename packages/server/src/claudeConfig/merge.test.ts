import { describe, expect, test } from "bun:test";
import type { ClaudeConfigOrigin } from "@thinkrail/contracts";
import { flatten, isUnionKey, resolveSettings, type ScopedDocument } from "./merge";

const at = (scope: ClaudeConfigOrigin["scope"], path: string): ClaudeConfigOrigin => ({
	scope,
	path,
});

const doc = (
	scope: ClaudeConfigOrigin["scope"],
	path: string,
	data: Record<string, unknown>,
): ScopedDocument => ({ origin: at(scope, path), data });

describe("flatten", () => {
	test("flattens nested objects to dotted keys so sibling keys resolve independently", () => {
		expect([
			...flatten({ permissions: { defaultMode: "plan", allow: ["Bash"] }, model: "opus" }),
		]).toEqual([
			["permissions.defaultMode", { value: "plan", keyPath: ["permissions", "defaultMode"] }],
			["permissions.allow", { value: ["Bash"], keyPath: ["permissions", "allow"] }],
			["model", { value: "opus", keyPath: ["model"] }],
		]);
	});

	test("treats arrays as leaves rather than descending into indices", () => {
		expect([...flatten({ list: [{ a: 1 }] })]).toEqual([
			["list", { value: [{ a: 1 }], keyPath: ["list"] }],
		]);
	});

	test("keeps the segments a key with a dot in its name cannot be split back into", () => {
		const flat = flatten({ env: { "MY.VAR": "1" } });
		expect(flat.get("env.MY.VAR")?.keyPath).toEqual(["env", "MY.VAR"]);
	});
});

describe("isUnionKey", () => {
	test("recognises the permission lists that union across scopes", () => {
		expect(isUnionKey("permissions.allow")).toBe(true);
		expect(isUnionKey("permissions.deny")).toBe(true);
		expect(isUnionKey("permissions.additionalDirectories")).toBe(true);
		expect(isUnionKey("sandbox.network.allowedDomains")).toBe(true);
	});

	test("does not treat ordinary keys as unioned", () => {
		expect(isUnionKey("permissions.defaultMode")).toBe(false);
		expect(isUnionKey("model")).toBe(false);
	});
});

describe("resolveSettings", () => {
	test("a scalar is won by the highest scope, and the rest are recorded as shadows", () => {
		const resolved = resolveSettings([
			doc("local", "/w/.claude/settings.local.json", {
				permissions: { defaultMode: "acceptEdits" },
			}),
			doc("project", "/w/.claude/settings.json", { permissions: { defaultMode: "plan" } }),
			doc("user", "/h/settings.json", { permissions: { defaultMode: "default" } }),
		]);

		expect(resolved).toHaveLength(1);
		expect(resolved[0]?.value).toBe("acceptEdits");
		expect(resolved[0]?.origin.scope).toBe("local");
		expect(resolved[0]?.shadowed.map((s) => [s.origin.scope, s.value])).toEqual([
			["project", "plan"],
			["user", "default"],
		]);
	});

	test("permission lists union across every scope instead of the top one winning", () => {
		const resolved = resolveSettings([
			doc("project", "/w/.claude/settings.json", { permissions: { allow: ["Bash(npm test)"] } }),
			doc("user", "/h/settings.json", { permissions: { allow: ["Read(~/notes)"] } }),
		]);

		expect(resolved[0]?.value).toEqual(["Bash(npm test)", "Read(~/notes)"]);
	});

	test("union dedupes a rule granted in two scopes", () => {
		const resolved = resolveSettings([
			doc("local", "/w/.claude/settings.local.json", { permissions: { allow: ["WebSearch"] } }),
			doc("user", "/h/settings.json", { permissions: { allow: ["WebSearch"] } }),
		]);

		expect(resolved[0]?.value).toEqual(["WebSearch"]);
		expect(resolved[0]?.shadowed).toHaveLength(1);
	});

	test("a key present in only one scope has no shadows", () => {
		const resolved = resolveSettings([doc("user", "/h/settings.json", { model: "opus" })]);
		expect(resolved[0]?.shadowed).toEqual([]);
	});

	test("sibling keys under one object resolve from different scopes independently", () => {
		const resolved = resolveSettings([
			doc("local", "/w/.claude/settings.local.json", { permissions: { defaultMode: "auto" } }),
			doc("project", "/w/.claude/settings.json", { permissions: { deny: ["Bash(rm *)"] } }),
		]);

		const mode = resolved.find((entry) => entry.key === "permissions.defaultMode");
		const deny = resolved.find((entry) => entry.key === "permissions.deny");
		expect(mode?.origin.scope).toBe("local");
		expect(deny?.origin.scope).toBe("project");
		expect(deny?.shadowed).toEqual([]);
	});

	test("a union key falls back to override when a scope holds a non-array", () => {
		const resolved = resolveSettings([
			doc("local", "/w/.claude/settings.local.json", { permissions: { allow: "not-a-list" } }),
			doc("user", "/h/settings.json", { permissions: { allow: ["Bash"] } }),
		]);

		expect(resolved[0]?.value).toBe("not-a-list");
	});

	test("no documents yields nothing rather than throwing", () => {
		expect(resolveSettings([])).toEqual([]);
	});
});
