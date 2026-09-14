import { expect, test } from "bun:test";
import { join } from "node:path";
import { activate, DRAIN_TIMEOUT_MS, deactivate } from "./activation";
import { beginCall, drain, endCall, PluginRegistry } from "./registry";
import { fixtureModule, fixtureSeams } from "./testFixtures";

test("activate runs the module's activate() and records its disposer", async () => {
	const registry = new PluginRegistry();
	let disposed = false;
	registry.registerBuiltin(
		fixtureModule("spec-dialect", {
			activate: () => () => {
				disposed = true;
			},
		}),
	);
	await activate("spec-dialect", registry, fixtureSeams());
	expect(registry.get("spec-dialect")?.state).toBe("active");
	await deactivate("spec-dialect", registry, fixtureSeams());
	expect(disposed).toBe(true);
	expect(registry.get("spec-dialect")?.state).toBe("disabled");
});

test("a throwing activate() fails the plugin with the error message as the reason", async () => {
	const registry = new PluginRegistry();
	registry.registerBuiltin(
		fixtureModule("spec-dialect", {
			activate: () => {
				throw new Error("boom");
			},
		}),
	);
	await activate("spec-dialect", registry, fixtureSeams());
	const entry = registry.get("spec-dialect");
	expect(entry?.state).toBe("failed");
	expect(entry?.reason).toBe("boom");
});

test("a builtin plugin's assetsDir resolves through bundledPluginRuntime when it has staged one", async () => {
	const registry = new PluginRegistry();
	const captured: { assetsDir: string | null } = { assetsDir: null };
	registry.registerBuiltin(
		fixtureModule("spec-dialect", {
			activate: (ctx) => {
				captured.assetsDir = ctx.assetsDir;
				return undefined;
			},
		}),
	);
	await activate(
		"spec-dialect",
		registry,
		fixtureSeams({
			bundledPluginRuntime: () => ({ factories: [], skillsDir: null, assetsDir: "/staged/assets" }),
		}),
	);
	expect(captured.assetsDir).toBe("/staged/assets");
});

test("a builtin plugin's assetsDir falls back to its own build-support in dev", async () => {
	const registry = new PluginRegistry();
	const captured: { assetsDir: string | null } = { assetsDir: null };
	registry.registerBuiltin(
		fixtureModule("claude-code", {
			activate: (ctx) => {
				captured.assetsDir = ctx.assetsDir;
				return undefined;
			},
		}),
	);
	await activate("claude-code", registry, fixtureSeams());
	expect(captured.assetsDir).toBe(
		join(import.meta.dir, "..", "..", "..", "plugin-claude-code", "assets"),
	);
});

test("a contract that declares enabled in its settings is refused, not activated", async () => {
	const registry = new PluginRegistry();
	const { Type } = await import("typebox");
	registry.registerBuiltin(
		fixtureModule("spec-dialect", {
			contract: { settings: Type.Object({ enabled: Type.Boolean() }) },
		}),
	);
	await activate("spec-dialect", registry, fixtureSeams());
	expect(registry.get("spec-dialect")?.state).toBe("refused");
});

test("a publish call from a disposed activation is dropped", async () => {
	const registry = new PluginRegistry();
	let publishAfterDispose: (() => void) | undefined;
	registry.registerBuiltin(
		fixtureModule("spec-dialect", {
			activate: (ctx) => {
				publishAfterDispose = () => ctx.publish("changed", {});
				return undefined;
			},
		}),
	);
	let published: unknown[] = [];
	await activate(
		"spec-dialect",
		registry,
		fixtureSeams({ publish: (_channel, payload) => published.push(payload) }),
	);
	await deactivate("spec-dialect", registry, fixtureSeams());
	published = [];
	publishAfterDispose?.();
	expect(published).toEqual([]);
});

test("a timer firing after dispose cannot register a new method", async () => {
	const registry = new PluginRegistry();
	let registerLate: (() => void) | undefined;
	registry.registerBuiltin(
		fixtureModule("spec-dialect", {
			activate: (ctx) => {
				registerLate = () => ctx.method("lateMethod", () => "should not land");
				return undefined;
			},
		}),
	);
	await activate("spec-dialect", registry, fixtureSeams());
	await deactivate("spec-dialect", registry, fixtureSeams());
	registerLate?.();
	// A fresh activation must not see a method a stale closure tried to register into it.
	await activate("spec-dialect", registry, fixtureSeams());
	expect(registry.activationOf("spec-dialect")?.methods.has("lateMethod")).toBe(false);
});

test("drain resolves once the in-flight call completes, before the disposer runs", async () => {
	const registry = new PluginRegistry();
	const order: string[] = [];
	registry.registerBuiltin(
		fixtureModule("spec-dialect", {
			activate: () => () => {
				order.push("disposed");
			},
		}),
	);
	await activate("spec-dialect", registry, fixtureSeams());
	const tables = registry.activationOf("spec-dialect");
	if (!tables) throw new Error("expected an activation");
	beginCall(tables);
	order.push("call-started");

	const deactivation = deactivate("spec-dialect", registry, fixtureSeams());
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(order).toEqual(["call-started"]);

	endCall(tables);
	await deactivation;
	expect(order).toEqual(["call-started", "disposed"]);
});

test("the disposer timeout is bounded: deactivate does not hang on a disposer that never settles", async () => {
	const registry = new PluginRegistry();
	registry.registerBuiltin(
		fixtureModule("spec-dialect", {
			activate: () => () => new Promise<void>(() => {}),
		}),
	);
	await activate("spec-dialect", registry, fixtureSeams());
	const start = Date.now();
	await deactivate("spec-dialect", registry, fixtureSeams(), 20, 20);
	expect(Date.now() - start).toBeLessThan(1000);
	expect(registry.activationOf("spec-dialect")).toBeUndefined();
});

test("drain is bounded by its timeout when the in-flight call never finishes", async () => {
	const registry = new PluginRegistry();
	registry.registerBuiltin(fixtureModule("spec-dialect"));
	await activate("spec-dialect", registry, fixtureSeams());
	const tables = registry.activationOf("spec-dialect");
	if (!tables) throw new Error("expected an activation");
	beginCall(tables);
	const start = Date.now();
	await drain(tables, 20);
	expect(Date.now() - start).toBeLessThan(DRAIN_TIMEOUT_MS);
});
