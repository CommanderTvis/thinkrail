import { expect, test } from "bun:test";
import { PluginReconciler } from "./reconciler";
import { PluginRegistry } from "./registry";
import { fixtureModule, fixtureSeams } from "./testFixtures";

test("boot enables a builtin plugin whose manifest defaults it on", async () => {
	const registry = new PluginRegistry();
	registry.registerBuiltin(fixtureModule("spec-dialect", { manifest: { enabledByDefault: true } }));
	const reconciler = new PluginReconciler(registry, fixtureSeams());
	await reconciler.schedule();
	expect(registry.get("spec-dialect")?.state).toBe("active");
});

test("an external plugin never auto-enables without an explicit config entry", async () => {
	const registry = new PluginRegistry();
	registry.upsertExternal(
		fixtureModule("widgets", { manifest: { enabledByDefault: true } }).manifest,
		"/plugins/widgets",
	);
	registry.setModule("widgets", fixtureModule("widgets", { manifest: { enabledByDefault: true } }));
	const reconciler = new PluginReconciler(registry, fixtureSeams());
	await reconciler.schedule();
	expect(registry.get("widgets")?.state).toBe("disabled");
});

test("disabling a plugin via config deactivates it", async () => {
	const registry = new PluginRegistry();
	registry.registerBuiltin(fixtureModule("spec-dialect", { manifest: { enabledByDefault: true } }));
	const seams = fixtureSeams({}, { plugins: { "spec-dialect": { enabled: false } } });
	const reconciler = new PluginReconciler(registry, seams);
	await reconciler.schedule();
	expect(registry.get("spec-dialect")?.state).toBe("disabled");
});

test("disabling a dependency cascades: the dependent is never activated", async () => {
	const registry = new PluginRegistry();
	registry.registerBuiltin(fixtureModule("spec-dialect", { manifest: { enabledByDefault: true } }));
	registry.registerBuiltin(
		fixtureModule("blueprint", {
			manifest: { enabledByDefault: true, dependsOn: [{ id: "spec-dialect", wireVersion: 1 }] },
		}),
	);
	const seams = fixtureSeams({}, { plugins: { "spec-dialect": { enabled: false } } });
	const reconciler = new PluginReconciler(registry, seams);
	await reconciler.schedule();
	expect(registry.get("spec-dialect")?.state).toBe("disabled");
	expect(registry.get("blueprint")?.state).toBe("disabled");
});

test("a failed activation is not retried by a later reconcile until retry() is called", async () => {
	const registry = new PluginRegistry();
	let attempts = 0;
	registry.registerBuiltin(
		fixtureModule("spec-dialect", {
			manifest: { enabledByDefault: true },
			activate: () => {
				attempts += 1;
				throw new Error("boom");
			},
		}),
	);
	const seams = fixtureSeams();
	const reconciler = new PluginReconciler(registry, seams);
	await reconciler.schedule();
	expect(registry.get("spec-dialect")?.state).toBe("failed");
	await reconciler.schedule();
	expect(attempts).toBe(1);

	registry.setState("spec-dialect", "disabled");
	await reconciler.schedule();
	expect(attempts).toBe(2);
});

test("a dependent is not activated in the same pass its dependency fails", async () => {
	const registry = new PluginRegistry();
	registry.registerBuiltin(
		fixtureModule("spec-dialect", {
			manifest: { enabledByDefault: true },
			activate: () => {
				throw new Error("boom");
			},
		}),
	);
	registry.registerBuiltin(
		fixtureModule("blueprint", {
			manifest: { enabledByDefault: true, dependsOn: [{ id: "spec-dialect", wireVersion: 1 }] },
		}),
	);
	const reconciler = new PluginReconciler(registry, fixtureSeams());
	await reconciler.schedule();
	expect(registry.get("spec-dialect")?.state).toBe("failed");
	expect(registry.get("blueprint")?.state).toBe("failed");
});

test("overlapping schedule() calls coalesce into one more pass rather than piling up", async () => {
	const registry = new PluginRegistry();
	registry.registerBuiltin(fixtureModule("spec-dialect", { manifest: { enabledByDefault: true } }));
	const reconciler = new PluginReconciler(registry, fixtureSeams());
	const first = reconciler.schedule();
	const second = reconciler.schedule();
	await Promise.all([first, second]);
	expect(registry.get("spec-dialect")?.state).toBe("active");
});
