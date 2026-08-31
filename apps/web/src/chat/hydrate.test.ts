import { expect, test } from "bun:test";
import type { ChatCapabilities, ChatMessage, ConfigOption } from "@thinkrail/contracts";
import { hydrateRuntime } from "./hydrate";

const capabilities = {
	agent: { id: "pi", name: "pi", origin: "bundled" },
	derivedFrom: {},
} as unknown as ChatCapabilities;

test("hydrateRuntime bundles the session.getMessages response fields verbatim, by name not position", () => {
	const messages: ChatMessage[] = [
		{ role: "user", id: "m1", timestamp: 1, content: [{ type: "text", text: "hi" }] },
	];
	const configOptions: ConfigOption[] = [];
	const plan = { entries: [{ text: "step one", status: "pending" as const }] };

	const hydrated = hydrateRuntime(messages, configOptions, capabilities, plan);

	expect(hydrated.messages).toBe(messages);
	expect(hydrated.configOptions).toBe(configOptions);
	expect(hydrated.capabilities).toBe(capabilities);
	expect(hydrated.plan).toBe(plan);
});

test("hydrateRuntime carries a withdrawn plan and an empty transcript through unchanged", () => {
	const hydrated = hydrateRuntime([], [], capabilities, null);

	expect(hydrated.messages).toEqual([]);
	expect(hydrated.plan).toBeNull();
});
