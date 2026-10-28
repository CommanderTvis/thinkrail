import { expect, test } from "bun:test";
import type { Credential } from "@earendil-works/pi-ai";
import { grazieFetch, jetbrainsAiProvider, parseCentralExport } from "./jetbrains";
import { sessionOnly } from "./models";

const asFetch = (call: (input: string | URL | Request, init?: RequestInit) => Promise<Response>) =>
	Object.assign(call, { preconnect: () => {} });

const exported = (envelope: unknown) =>
	`central-${Buffer.from(JSON.stringify(envelope)).toString("base64url")}`;
const jwt = (exp: number) => `h.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.s`;

test("a Central export yields its refresh token", () => {
	expect(parseCentralExport(exported({ refresh_token: "r" }))).toEqual({ refreshToken: "r" });
	expect(() => parseCentralExport("nonsense")).toThrow("central login export");
});

test("Grazie requests carry only the headers its preflight allows and none of the fields it rejects", async () => {
	let sent: Headers | undefined;
	let sentBody: unknown;
	const wrapped = grazieFetch(
		asFetch(async (_input, init) => {
			sent = new Headers(init?.headers);
			sentBody = init?.body;
			return new Response("{}");
		}),
	);
	await wrapped("https://api.jetbrains.ai/x", {
		headers: {
			"x-api-key": "token",
			"content-type": "application/json",
			"anthropic-version": "2023-06-01",
		},
		body: JSON.stringify({
			model: "m",
			output_config: { effort: "high" },
			thinking: { type: "adaptive", block_binding: {} },
			messages: [
				{ role: "system", content: [], output_config: { effort: "high" } },
				{ role: "user", content: "hi" },
			],
		}),
	});
	expect(JSON.parse(String(sentBody))).toEqual({
		model: "m",
		thinking: { type: "adaptive" },
		messages: [{ role: "user", content: "hi" }],
	});
	expect([...(sent?.keys() ?? [])].sort()).toEqual(["content-type", "grazie-authenticate-jwt"]);
	expect(sent?.get("grazie-authenticate-jwt")).toBe("token");
});

test("login mints a Grazie JWT from the Central session and the licence, and keeps no refresh token", async () => {
	const exp = Math.floor(Date.now() / 1000) + 3600;
	const calls: string[] = [];
	const provider = jetbrainsAiProvider(
		[],
		asFetch(async (input, init) => {
			const url = String(input);
			calls.push(url);
			if (url.includes("oauth2/token")) return Response.json({ id_token: "id" });
			expect(new Headers(init?.headers).get("authorization")).toBe("Bearer id");
			expect(JSON.parse(String(init?.body))).toEqual({ licenseId: "L1" });
			return Response.json({ state: "NONE", token: jwt(exp) });
		}),
	);
	const answers = ["L1", exported({ refresh_token: "r" })];
	const credential = await provider.auth.oauth?.login({
		signal: new AbortController().signal,
		prompt: async () => answers.shift() ?? "",
		notify: () => {},
	});
	expect(credential).toMatchObject({ type: "oauth", refresh: "" });
	expect(credential?.expires).toBeLessThan(Date.now() + 3_700_000);
	expect(credential?.expires).toBeLessThan(exp * 1000 + 1);
	expect(calls).toHaveLength(2);
});

test("the JetBrains AI credential stays in memory and is never written to the persisted file", () => {
	let persisted: Record<string, Credential> = {};
	const file = sessionOnly({ read: () => persisted, write: (next) => (persisted = next) });
	const jetbrains: Credential = { type: "oauth", refresh: "", access: "jwt", expires: 1 };
	file.write({ openai: { type: "api_key", key: "k" }, "jetbrains-ai": jetbrains });
	expect(Object.keys(persisted)).toEqual(["openai"]);
	expect(JSON.stringify(persisted)).not.toContain("jwt");
	expect(file.read()["jetbrains-ai"]).toEqual(jetbrains);
	file.write({ openai: { type: "api_key", key: "k" } });
	expect(file.read()["jetbrains-ai"]).toBeUndefined();
});

test("a pasted Grazie token is used as it is, for at most an hour, and the command carries the licence ID", async () => {
	const asked: string[] = [];
	const exp = Math.floor(Date.now() / 1000) + 86_400;
	const provider = jetbrainsAiProvider(
		[],
		asFetch(async () => Response.json({})),
	);
	const credential = await provider.auth.oauth?.login({
		signal: new AbortController().signal,
		prompt: async (prompt) => {
			asked.push("message" in prompt ? prompt.message : "");
			return asked.length === 1 ? "L1" : jwt(exp);
		},
		notify: () => {},
	});
	expect(credential).toMatchObject({ type: "oauth", refresh: "", access: jwt(exp) });
	expect(credential?.expires).toBeLessThan(Date.now() + 3_700_000);
	expect(asked[1]).toContain("LICENSE_ID=L1 &&");
});

test("a licence ID that could break out of the command is refused", async () => {
	const provider = jetbrainsAiProvider(
		[],
		asFetch(async () => Response.json({})),
	);
	await expect(
		provider.auth.oauth?.login({
			signal: new AbortController().signal,
			prompt: async () => "L1; rm -rf ~",
			notify: () => {},
		}),
	).rejects.toThrow("not a licence ID");
});
