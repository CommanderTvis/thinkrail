import { expect, test } from "bun:test";
import { Type } from "typebox";
import { PluginRegistry, validateContractIntake } from "./registry";
import { fixtureContract, fixtureModule } from "./testFixtures";

test("roster reflects registered plugins, their dependencies and state", () => {
	const registry = new PluginRegistry();
	registry.registerBuiltin(fixtureModule("spec-dialect"));
	registry.registerBuiltin(
		fixtureModule("blueprint", {
			manifest: {
				description: "Authors interactive specs.",
				dependsOn: [{ id: "spec-dialect", wireVersion: 1 }],
			},
		}),
	);
	const roster = registry.roster();
	expect(roster.map((entry) => entry.id).sort()).toEqual(["blueprint", "spec-dialect"]);
	const blueprint = roster.find((entry) => entry.id === "blueprint");
	expect(blueprint?.dependsOn).toEqual(["spec-dialect"]);
	expect(blueprint?.status).toBe("disabled");
	expect(blueprint?.description).toBe("Authors interactive specs.");
	expect(roster.find((entry) => entry.id === "spec-dialect")?.description).toBeUndefined();
});

test("topologicalOrder puts a dependency before its dependent", () => {
	const registry = new PluginRegistry();
	registry.registerBuiltin(
		fixtureModule("blueprint", {
			manifest: { dependsOn: [{ id: "spec-dialect", wireVersion: 1 }] },
		}),
	);
	registry.registerBuiltin(fixtureModule("spec-dialect"));
	const { order, cycle } = registry.topologicalOrder();
	expect(cycle).toEqual([]);
	expect(order.indexOf("spec-dialect")).toBeLessThan(order.indexOf("blueprint"));
});

test("topologicalOrder reports a cycle instead of silently dropping it", () => {
	const registry = new PluginRegistry();
	registry.registerBuiltin(
		fixtureModule("a", { manifest: { dependsOn: [{ id: "b", wireVersion: 1 }] } }),
	);
	registry.registerBuiltin(
		fixtureModule("b", { manifest: { dependsOn: [{ id: "a", wireVersion: 1 }] } }),
	);
	const { order, cycle } = registry.topologicalOrder();
	expect(order).toEqual([]);
	expect(cycle.sort()).toEqual(["a", "b"]);
});

test("validateContractIntake refuses a state channel naming an unknown snapshot method", () => {
	const contract = fixtureContract("spec-dialect", {
		channels: {
			tree: { kind: "state", payload: Type.Object({}), snapshot: "getTree", key: [] },
		},
	});
	const result = validateContractIntake(contract);
	expect(result).toEqual({
		refused: 'plugin spec-dialect channel "tree" names unknown snapshot method "getTree"',
	});
});

test("validateContractIntake accepts a state channel naming a real snapshot method", () => {
	const contract = fixtureContract("spec-dialect", {
		methods: { getTree: { params: Type.Object({}), result: Type.Object({}) } },
		channels: {
			tree: { kind: "state", payload: Type.Object({}), snapshot: "getTree", key: [] },
		},
	});
	expect(validateContractIntake(contract)).toEqual({ ok: true });
});

test("validateContractIntake refuses a settings schema that declares enabled", () => {
	const contract = fixtureContract("spec-dialect", {
		settings: Type.Object({ enabled: Type.Boolean() }),
	});
	expect(validateContractIntake(contract)).toEqual({
		refused: 'plugin spec-dialect settings schema may not declare "enabled"',
	});
});

test("upsertExternal leaves an active plugin's module and state alone when the manifest is unchanged", () => {
	const registry = new PluginRegistry();
	const module = fixtureModule("widgets");
	registry.upsertExternal(module.manifest, "/plugins/widgets");
	registry.setModule("widgets", module);
	registry.setState("widgets", "active");

	registry.upsertExternal({ ...module.manifest }, "/plugins/widgets");

	const entry = registry.get("widgets");
	expect(entry?.state).toBe("active");
	expect(entry?.module).toBe(module);
});

test("upsertExternal drops the stale module and reopens for reactivation when the manifest actually changes", () => {
	const registry = new PluginRegistry();
	const module = fixtureModule("widgets");
	registry.upsertExternal(module.manifest, "/plugins/widgets");
	registry.setModule("widgets", module);
	registry.setState("widgets", "active");

	registry.upsertExternal(
		fixtureModule("widgets", { manifest: { version: "0.0.1" } }).manifest,
		"/plugins/widgets",
	);

	const entry = registry.get("widgets");
	expect(entry?.state).toBe("disabled");
	expect(entry?.module).toBeUndefined();
});

test("registerRefusedExternal tracks a broken plugin without a usable id, keyed by directory", () => {
	const registry = new PluginRegistry();
	registry.registerRefusedExternal("/plugins/broken", "cannot read thinkrail-plugin.json");
	const roster = registry.roster();
	expect(roster).toHaveLength(1);
	expect(roster[0]?.status).toBe("refused");
});
