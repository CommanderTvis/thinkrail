import { expect, test } from "bun:test";
import type { ProviderInfo } from "@agentclientprotocol/sdk";
import { toAgentProviders, toSetProviderRequest } from "./providers";

function providers(payload: unknown): ReturnType<typeof toAgentProviders> {
	return toAgentProviders(payload as ProviderInfo[]);
}

test("a populated current config reads as configured, with its base URL", () => {
	expect(
		providers([
			{
				providerId: "main",
				supported: ["anthropic"],
				required: true,
				current: { apiType: "anthropic", baseUrl: "https://api.anthropic.com" },
			},
		]),
	).toEqual([
		{
			id: "main",
			required: true,
			configured: true,
			protocols: ["anthropic"],
			baseUrl: "https://api.anthropic.com",
		},
	]);
});

test("a null current config reads as disabled, with no base URL", () => {
	expect(
		providers([{ providerId: "spare", supported: ["openai"], required: false, current: null }]),
	).toEqual([{ id: "spare", required: false, configured: false, protocols: ["openai"] }]);
});

test("an omitted current config also reads as disabled", () => {
	expect(providers([{ providerId: "spare", supported: [], required: false }])).toEqual([
		{ id: "spare", required: false, configured: false, protocols: [] },
	]);
});

test("a missing supported list reports no protocols rather than dropping the provider", () => {
	expect(providers([{ providerId: "main", required: true, current: null }])).toEqual([
		{ id: "main", required: true, configured: false, protocols: [] },
	]);
});

test("an entry with no readable providerId is dropped", () => {
	expect(providers([{ supported: ["anthropic"], required: true }, "not an object", null])).toEqual(
		[],
	);
});

test("a non-array value reports no providers", () => {
	expect(providers(undefined)).toEqual([]);
	expect(providers(null)).toEqual([]);
});

test("the routing round-trips into a SetProviderRequest, headers included only when given", () => {
	expect(
		toSetProviderRequest({
			providerId: "main",
			apiType: "anthropic",
			baseUrl: "https://api.anthropic.com",
			headers: { Authorization: "Bearer token" },
		}),
	).toEqual({
		providerId: "main",
		apiType: "anthropic",
		baseUrl: "https://api.anthropic.com",
		headers: { Authorization: "Bearer token" },
	});

	expect(
		toSetProviderRequest({
			providerId: "main",
			apiType: "anthropic",
			baseUrl: "https://api.anthropic.com",
		}),
	).toEqual({ providerId: "main", apiType: "anthropic", baseUrl: "https://api.anthropic.com" });
});
