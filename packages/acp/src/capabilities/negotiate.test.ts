import { expect, test } from "bun:test";
import { authMethods } from "./negotiate";

test("an agent-handled method needs no type field", () => {
	expect(authMethods([{ id: "oauth", name: "Sign in with Anthropic" }])).toEqual([
		{ id: "oauth", name: "Sign in with Anthropic", kind: "agent" },
	]);
});

test("an env_var method carries its variables and its link", () => {
	expect(
		authMethods([
			{
				type: "env_var",
				id: "api-key",
				name: "API key",
				description: "Paste a key from your provider.",
				link: "https://example.invalid/keys",
				vars: [
					{ name: "OPENAI_API_KEY", label: "OpenAI key", secret: true, optional: false },
					{ name: "OPENAI_ORG_ID" },
				],
			},
		]),
	).toEqual([
		{
			id: "api-key",
			name: "API key",
			kind: "envVar",
			description: "Paste a key from your provider.",
			link: "https://example.invalid/keys",
			envVars: [
				{ name: "OPENAI_API_KEY", label: "OpenAI key", secret: true, optional: false },
				{ name: "OPENAI_ORG_ID" },
			],
		},
	]);
});

test("a terminal method carries no env vars", () => {
	expect(authMethods([{ type: "terminal", id: "tui", name: "Sign in via terminal" }])).toEqual([
		{ id: "tui", name: "Sign in via terminal", kind: "terminal" },
	]);
});

test("a terminal method carries its args and env, for the client to launch it with", () => {
	expect(
		authMethods([
			{
				type: "terminal",
				id: "tui",
				name: "Sign in via terminal",
				args: ["auth", "login"],
				env: { AGENT_AUTH_MODE: "interactive" },
			},
		]),
	).toEqual([
		{
			id: "tui",
			name: "Sign in via terminal",
			kind: "terminal",
			terminalArgs: ["auth", "login"],
			terminalEnv: { AGENT_AUTH_MODE: "interactive" },
		},
	]);
});

test("a terminal method with empty args and env carries neither", () => {
	expect(
		authMethods([{ type: "terminal", id: "tui", name: "Sign in via terminal", args: [], env: {} }]),
	).toEqual([{ id: "tui", name: "Sign in via terminal", kind: "terminal" }]);
});

test("args and env on a non-terminal method are not carried", () => {
	expect(
		authMethods([{ id: "oauth", name: "Sign in", args: ["ignored"], env: { IGNORED: "1" } }]),
	).toEqual([{ id: "oauth", name: "Sign in", kind: "agent" }]);
});

test("an unrecognised type falls back to agent, matching the default the spec names", () => {
	expect(authMethods([{ type: "future_kind", id: "x", name: "X" }])).toEqual([
		{ id: "x", name: "X", kind: "agent" },
	]);
});

test("an entry with no id or no name is dropped", () => {
	expect(authMethods([{ name: "No id" }, { id: "no-name" }, "not an object", null])).toEqual([]);
});

test("a non-array value reports no methods", () => {
	expect(authMethods(undefined)).toEqual([]);
	expect(authMethods(null)).toEqual([]);
});
