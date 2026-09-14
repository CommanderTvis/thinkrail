import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BLUEPRINT_FILE, resolveBlueprintSource } from "./document";
import { describeSource, openingPrompt } from "./prompts";

function worktree(): string {
	const dir = mkdtempSync(join(tmpdir(), "trbp-takeover-"));
	mkdirSync(join(dir, "docs"), { recursive: true });
	writeFileSync(join(dir, "docs", "ARCHITECTURE.md"), "# Architecture\n", "utf8");
	return dir;
}

describe("what a takeover is allowed to read", () => {
	it("stores a chosen document relative to the worktree, whichever way it was named", () => {
		const dir = worktree();
		try {
			for (const path of [join(dir, "docs", "ARCHITECTURE.md"), "docs/ARCHITECTURE.md"]) {
				expect(resolveBlueprintSource(dir, { kind: "spec", path })).toEqual({
					kind: "spec",
					path: join("docs", "ARCHITECTURE.md"),
				});
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("refuses a document outside the project, so an agent is never started on a stranger's file", () => {
		const dir = worktree();
		try {
			expect(() =>
				resolveBlueprintSource(dir, { kind: "spec", path: "../elsewhere/SECRETS.md" }),
			).toThrow("inside this project");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("refuses a path that is not there, before a workspace is spent on it", () => {
		const dir = worktree();
		try {
			expect(() => resolveBlueprintSource(dir, { kind: "spec", path: "docs/MISSING.md" })).toThrow(
				"no file at docs/MISSING.md",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("still refuses an empty brief, and trims the one it keeps", () => {
		const dir = worktree();
		try {
			expect(() => resolveBlueprintSource(dir, { kind: "idea", brief: "   " })).toThrow(
				"Describe what you want to build",
			);
			expect(resolveBlueprintSource(dir, { kind: "idea", brief: "  lights  " })).toEqual({
				kind: "idea",
				brief: "lights",
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("what each source asks the author for", () => {
	it("a product takeover reads the code and writes the decisions already made", () => {
		const prompt = openingPrompt({ kind: "product" });
		expect(prompt).toContain("Read this project");
		expect(prompt).toContain("build files");
		expect(prompt).toContain(BLUEPRINT_FILE);
		expect(prompt).toContain("selected");
	});

	it("a document takeover names the source, and says it is not the draft", () => {
		const prompt = openingPrompt({ kind: "spec", path: "docs/ARCHITECTURE.md" });
		expect(prompt).toContain("Read docs/ARCHITECTURE.md");
		expect(prompt).toContain(`Leave docs/ARCHITECTURE.md exactly as it is`);
		expect(prompt).toContain(`into ${BLUEPRINT_FILE}`);
	});

	it("both takeovers ask for the alternatives a rewrite would weigh", () => {
		for (const source of [
			{ kind: "product" } as const,
			{ kind: "spec", path: "docs/ARCHITECTURE.md" } as const,
		]) {
			const prompt = openingPrompt(source);
			expect(prompt).toContain("alternatives are the ones a rewrite would seriously consider");
			expect(prompt).toContain("Do not invent a decision");
		}
	});

	it("an idea is still asked for, in its own words", () => {
		const prompt = openingPrompt({ kind: "idea", brief: "an app to control my lightbulbs" });
		expect(prompt).toContain("an app to control my lightbulbs");
		expect(prompt).not.toContain("Read this project");
	});
});

describe("what the panel says a spec came from", () => {
	it("names the brief, the project, or the document", () => {
		expect(describeSource({ kind: "idea", brief: " lights " })).toBe("lights");
		expect(describeSource({ kind: "product" })).toBe("Taken over from this project's code");
		expect(describeSource({ kind: "spec", path: "docs/ARCHITECTURE.md" })).toBe(
			"Taken over from docs/ARCHITECTURE.md",
		);
	});
});
