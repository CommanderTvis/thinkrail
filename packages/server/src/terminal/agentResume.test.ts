import { describe, expect, test } from "bun:test";
import { agentSessionExists, isAgentSessionId, resumeCommand } from "./agentResume";

const ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

describe("resumeCommand", () => {
	test("appends the session to a bare invocation", () => {
		expect(resumeCommand("claude", ID)).toBe(`claude --resume ${ID}`);
	});

	test("keeps the flags the user chose", () => {
		expect(resumeCommand("claude --chrome --model opus", ID)).toBe(
			`claude --chrome --model opus --resume ${ID}`,
		);
	});

	test("replaces a resume from an earlier restore rather than stacking one", () => {
		expect(resumeCommand(`claude --chrome --resume ${OTHER}`, ID)).toBe(
			`claude --chrome --resume ${ID}`,
		);
		expect(resumeCommand(`claude -r ${OTHER}`, ID)).toBe(`claude --resume ${ID}`);
	});

	test("drops --continue, which would fight the explicit session", () => {
		expect(resumeCommand("claude --continue", ID)).toBe(`claude --resume ${ID}`);
		expect(resumeCommand("claude -c --chrome", ID)).toBe(`claude --chrome --resume ${ID}`);
	});

	test("a bare --resume is the picker, so it consumes no following flag", () => {
		expect(resumeCommand("claude --resume --chrome", ID)).toBe(`claude --chrome --resume ${ID}`);
	});

	test("collapses the whitespace the process table reports", () => {
		expect(resumeCommand("  claude   --chrome  ", ID)).toBe(`claude --chrome --resume ${ID}`);
	});

	test("refuses anything that is not a session id", () => {
		expect(resumeCommand("claude", "not-a-uuid")).toBeNull();
		expect(resumeCommand("claude", "")).toBeNull();
	});

	test("refuses an empty command", () => {
		expect(resumeCommand("   ", ID)).toBeNull();
	});
});

describe("isAgentSessionId", () => {
	test("accepts a UUID and rejects anything else", () => {
		expect(isAgentSessionId(ID)).toBe(true);
		expect(isAgentSessionId("claude")).toBe(false);
		expect(isAgentSessionId(`${ID} ; rm -rf /`)).toBe(false);
	});
});

describe("agentSessionExists", () => {
	test("refuses an id that is not a session id, without touching the disk", () => {
		expect(agentSessionExists("/tmp/project", "not-a-uuid")).toBe(false);
	});

	test("refuses an empty cwd", () => {
		expect(agentSessionExists("", ID)).toBe(false);
	});

	test("reports false for a session that was never written", () => {
		// The failure this exists for: a session started and killed before it had anything to save.
		expect(agentSessionExists("/tmp/definitely-not-a-project", ID)).toBe(false);
	});
});
