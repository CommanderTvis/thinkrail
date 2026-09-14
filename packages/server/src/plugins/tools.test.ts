import { expect, test } from "bun:test";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { activate } from "./activation";
import { drain, PluginRegistry } from "./registry";
import { fixtureModule, fixtureSeams } from "./testFixtures";
import { pluginMcpTools, pluginToolsExtension } from "./tools";

const PARAMS = Type.Object({ name: Type.String() });
const fakeCtx = {
	sessionManager: { getSessionId: () => "session-1" },
} as unknown as ExtensionContext;

test("an mcp-surface tool validates its arguments before running", async () => {
	const registry = new PluginRegistry();
	registry.registerBuiltin(
		fixtureModule("spec-dialect", {
			manifest: { enabledByDefault: true },
			activate: (ctx) => {
				ctx.tool({
					name: "greet",
					label: "Greet",
					description: "says hi",
					parameters: PARAMS,
					surfaces: ["mcp"],
					run: (params) => ({ text: `hi ${(params as { name: string }).name}` }),
				});
				return undefined;
			},
		}),
	);
	await activate("spec-dialect", registry, fixtureSeams());
	const tools = pluginMcpTools(registry, { workspaceId: "w1", tabKey: "t1" }, "/repo");
	const greet = tools.find((tool) => tool.name === "greet");
	if (!greet) throw new Error("expected the greet tool to be registered");

	const invalid = await greet.call({});
	expect(invalid.isError).toBe(true);

	const valid = await greet.call({ name: "Ada" });
	expect(valid).toEqual({ text: "hi Ada" });
});

test("an agent-surface tool is registered by toolsExtension on the extension API", async () => {
	const registry = new PluginRegistry();
	registry.registerBuiltin(
		fixtureModule("spec-dialect", {
			manifest: { enabledByDefault: true },
			activate: (ctx) => {
				ctx.tool({
					name: "greet",
					label: "Greet",
					description: "says hi",
					parameters: PARAMS,
					surfaces: ["agent"],
					run: (params) => ({ text: `hi ${(params as { name: string }).name}` }),
				});
				return undefined;
			},
		}),
	);
	await activate("spec-dialect", registry, fixtureSeams());

	const registered: ToolDefinition[] = [];
	const fakeApi = {
		registerTool: (tool: ToolDefinition) => registered.push(tool),
	} as unknown as ExtensionAPI;
	const extension = pluginToolsExtension(registry, () => ({ workspaceId: "w1", cwd: "/repo" }));
	await extension(fakeApi);

	expect(registered).toHaveLength(1);
	expect(registered[0]?.name).toBe("greet");
});

test("an mcp-surface tool is not exposed to the agent extension, and vice versa", async () => {
	const registry = new PluginRegistry();
	registry.registerBuiltin(
		fixtureModule("spec-dialect", {
			manifest: { enabledByDefault: true },
			activate: (ctx) => {
				ctx.tool({
					name: "mcpOnly",
					label: "MCP only",
					description: "mcp surface only",
					parameters: Type.Object({}),
					surfaces: ["mcp"],
					run: () => ({ text: "ok" }),
				});
				return undefined;
			},
		}),
	);
	await activate("spec-dialect", registry, fixtureSeams());

	const registered: ToolDefinition[] = [];
	const fakeApi = {
		registerTool: (tool: ToolDefinition) => registered.push(tool),
	} as unknown as ExtensionAPI;
	await pluginToolsExtension(registry, () => ({ workspaceId: null, cwd: "/repo" }))(fakeApi);
	expect(registered).toHaveLength(0);
});

test("a running mcp tool call counts toward the activation's drain, so deactivate() waits for it", async () => {
	const registry = new PluginRegistry();
	let release: (() => void) | undefined;
	registry.registerBuiltin(
		fixtureModule("spec-dialect", {
			manifest: { enabledByDefault: true },
			activate: (ctx) => {
				ctx.tool({
					name: "slow",
					label: "Slow",
					description: "awaits release",
					parameters: Type.Object({}),
					surfaces: ["mcp"],
					run: () => new Promise((resolve) => (release = () => resolve({ text: "done" }))),
				});
				return undefined;
			},
		}),
	);
	await activate("spec-dialect", registry, fixtureSeams());
	const tools = pluginMcpTools(registry, { workspaceId: "w1", tabKey: "t1" }, "/repo");
	const slow = tools.find((tool) => tool.name === "slow");
	if (!slow) throw new Error("expected the slow tool to be registered");

	const call = slow.call({});
	await Promise.resolve();
	const activation = registry.activationOf("spec-dialect");
	if (!activation) throw new Error("expected an activation");
	expect(activation.inFlight).toBe(1);

	let drained = false;
	const drainDone = drain(activation, 5000).then(() => {
		drained = true;
	});
	expect(drained).toBe(false);

	release?.();
	await call;
	await drainDone;
	expect(drained).toBe(true);
	expect(activation.inFlight).toBe(0);
});

test("a running agent tool call counts toward the activation's drain too", async () => {
	const registry = new PluginRegistry();
	let release: (() => void) | undefined;
	registry.registerBuiltin(
		fixtureModule("spec-dialect", {
			manifest: { enabledByDefault: true },
			activate: (ctx) => {
				ctx.tool({
					name: "slow",
					label: "Slow",
					description: "awaits release",
					parameters: PARAMS,
					surfaces: ["agent"],
					run: () => new Promise((resolve) => (release = () => resolve({ text: "done" }))),
				});
				return undefined;
			},
		}),
	);
	await activate("spec-dialect", registry, fixtureSeams());

	const registered: ToolDefinition[] = [];
	const fakeApi = {
		registerTool: (tool: ToolDefinition) => registered.push(tool),
	} as unknown as ExtensionAPI;
	await pluginToolsExtension(registry, () => ({ workspaceId: "w1", cwd: "/repo" }))(fakeApi);
	const slow = registered[0];
	if (!slow) throw new Error("expected the slow tool to be registered");

	const execution = slow.execute(
		"call-1",
		{ name: "Ada" },
		new AbortController().signal,
		() => {},
		fakeCtx,
	);
	await Promise.resolve();
	const activation = registry.activationOf("spec-dialect");
	if (!activation) throw new Error("expected an activation");
	expect(activation.inFlight).toBe(1);

	release?.();
	await execution;
	expect(activation.inFlight).toBe(0);
});
