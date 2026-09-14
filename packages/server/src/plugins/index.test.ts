import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLUGIN_API_GENERATION } from "@thinkrail/plugin-api";
import { installPlugins } from "./index";
import { fixtureSeams } from "./testFixtures";

const dirs: string[] = [];
function tempRoot(): string {
	const dir = mkdtempSync(join(tmpdir(), "thinkrail-plugin-runtime-"));
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeFixturePlugin(
	root: string,
	id: string,
	settingsSchema: unknown = { type: "object", properties: {} },
): void {
	const dir = join(root, id);
	mkdirSync(dir);
	writeFileSync(
		join(dir, "thinkrail-plugin.json"),
		JSON.stringify({
			id,
			label: id,
			icon: "puzzle",
			version: "0.0.0",
			apiGeneration: PLUGIN_API_GENERATION,
			wireVersion: 1,
			enabledByDefault: false,
			dependsOn: [],
			host: "host.js",
			web: "web.js",
			contributes: { sideTools: [], fileViewers: [] },
		}),
	);
	// Plain object literals shaped like typebox schemas, not an actual `import "typebox"`: an external
	// plugin's host.js runs from a directory with no reachable node_modules of its own, so a bare
	// specifier the framework happens to depend on is not something these fixtures can lean on.
	writeFileSync(
		join(dir, "host.js"),
		`export default {
			manifest: { id: "${id}", label: "${id}", icon: "puzzle", version: "0.0.0", apiGeneration: ${PLUGIN_API_GENERATION}, wireVersion: 1, enabledByDefault: false, dependsOn: [], contributes: { sideTools: [], fileViewers: [] } },
			contract: { id: "${id}", wireVersion: 1, methods: { ping: { params: { type: "object", properties: {} }, result: { type: "object", properties: {} } } }, channels: {}, settings: ${JSON.stringify(settingsSchema)} },
			activate: (ctx) => { ctx.method("ping", () => ({ pong: true })); return undefined; },
		};`,
	);
	writeFileSync(join(dir, "web.js"), "export default {};");
}

test("installPlugins discovers an external plugin, disabled until config says otherwise", async () => {
	const root = tempRoot();
	writeFixturePlugin(root, "fixture");
	const runtime = await installPlugins(fixtureSeams({}, { pluginPaths: [root] }));
	const roster = runtime.roster().filter((entry) => entry.origin === "external");
	expect(roster).toHaveLength(1);
	expect(roster[0]).toMatchObject({ id: "fixture", origin: "external", status: "disabled" });
});

test("enabling via config activates it, and its method answers over handleRequest", async () => {
	const root = tempRoot();
	writeFixturePlugin(root, "fixture");
	const seams = fixtureSeams({}, { pluginPaths: [root], plugins: { fixture: { enabled: true } } });
	const runtime = await installPlugins(seams);
	expect(runtime.roster().find((entry) => entry.id === "fixture")?.status).toBe("active");
	expect(await runtime.handleRequest("plugin.fixture.ping", {}, { clientKey: "test" })).toEqual({
		pong: true,
	});
});

test("serveRoute serves an external plugin's declared web file as a static asset", async () => {
	const root = tempRoot();
	writeFixturePlugin(root, "fixture");
	const runtime = await installPlugins(fixtureSeams({}, { pluginPaths: [root] }));
	const response = await runtime.serveRoute(
		new Request("http://localhost/plugin/fixture/web.js"),
		new URL("http://localhost/plugin/fixture/web.js"),
	);
	expect(response.status).toBe(200);
});

test("serveRoute serves a manifest-only builtin's declared assets from its resolved assets dir", async () => {
	const runtime = await installPlugins(fixtureSeams({}, {}));
	const response = await runtime.serveRoute(
		new Request("http://localhost/plugin/file-icons/assets/file-icons/typescript.svg"),
		new URL("http://localhost/plugin/file-icons/assets/file-icons/typescript.svg"),
	);
	expect(response.status).toBe(200);
	expect(await response.text()).toContain("<svg");
});

test("serveRoute 404s a missing builtin asset and a path-traversal attempt", async () => {
	const runtime = await installPlugins(fixtureSeams({}, {}));
	const missing = await runtime.serveRoute(
		new Request("http://localhost/plugin/file-icons/assets/file-icons/does-not-exist.svg"),
		new URL("http://localhost/plugin/file-icons/assets/file-icons/does-not-exist.svg"),
	);
	expect(missing.status).toBe(404);

	const traversal = await runtime.serveRoute(
		new Request("http://localhost/plugin/file-icons/assets/../../manifest.ts"),
		new URL("http://localhost/plugin/file-icons/assets/../../manifest.ts"),
	);
	expect(traversal.status).toBe(404);
});

test("rescan promotes a plugin out of refused once its manifest is fixed on disk", async () => {
	const root = tempRoot();
	mkdirSync(join(root, "broken"));
	writeFileSync(join(root, "broken", "thinkrail-plugin.json"), "not json");
	const runtime = await installPlugins(fixtureSeams({}, { pluginPaths: [root] }));
	expect(runtime.roster().some((entry) => entry.status === "refused")).toBe(true);

	rmSync(join(root, "broken"), { recursive: true, force: true });
	writeFixturePlugin(root, "broken");
	const roster = (await runtime.rescan()).filter((entry) => entry.origin === "external");
	expect(roster).toEqual([expect.objectContaining({ id: "broken", status: "disabled" })]);
});

test("rescan does not disconnect an already-active plugin whose manifest is unchanged", async () => {
	const root = tempRoot();
	writeFixturePlugin(root, "fixture");
	const runtime = await installPlugins(
		fixtureSeams({}, { pluginPaths: [root], plugins: { fixture: { enabled: true } } }),
	);
	expect(runtime.roster().find((entry) => entry.id === "fixture")?.status).toBe("active");
	expect(await runtime.handleRequest("plugin.fixture.ping", {}, { clientKey: "test" })).toEqual({
		pong: true,
	});

	await runtime.rescan();

	const roster = runtime.roster().find((entry) => entry.id === "fixture");
	expect(roster?.status).toBe("active");
	expect(await runtime.handleRequest("plugin.fixture.ping", {}, { clientKey: "test" })).toEqual({
		pong: true,
	});
});

test("dispose deactivates every active plugin", async () => {
	const root = tempRoot();
	writeFixturePlugin(root, "fixture");
	let disposed = false;
	writeFileSync(
		join(root, "fixture", "host.js"),
		`export default {
			manifest: { id: "fixture", label: "fixture", icon: "puzzle", version: "0.0.0", apiGeneration: ${PLUGIN_API_GENERATION}, wireVersion: 1, enabledByDefault: false, dependsOn: [], contributes: { sideTools: [], fileViewers: [] } },
			contract: { id: "fixture", wireVersion: 1, methods: {}, channels: {}, settings: { type: "object", properties: {} } },
			activate: () => () => { globalThis.__disposed = true; },
		};`,
	);
	const runtime = await installPlugins(
		fixtureSeams({}, { pluginPaths: [root], plugins: { fixture: { enabled: true } } }),
	);
	expect(runtime.roster().find((entry) => entry.id === "fixture")?.status).toBe("active");
	runtime.dispose();
	await new Promise((resolve) => setTimeout(resolve, 20));
	disposed = (globalThis as { __disposed?: boolean }).__disposed === true;
	expect(disposed).toBe(true);
});

test("dispose() deactivates a dependent before its dependency, so the dependent's disposer can still call it", async () => {
	const root = tempRoot();
	writeFixturePlugin(root, "dep");
	writeFixturePlugin(root, "main");
	writeFileSync(
		join(root, "main", "thinkrail-plugin.json"),
		JSON.stringify({
			id: "main",
			label: "main",
			icon: "puzzle",
			version: "0.0.0",
			apiGeneration: PLUGIN_API_GENERATION,
			wireVersion: 1,
			enabledByDefault: false,
			dependsOn: [{ id: "dep", wireVersion: 1 }],
			host: "host.js",
			web: "web.js",
			contributes: { sideTools: [], fileViewers: [] },
		}),
	);
	writeFileSync(
		join(root, "main", "host.js"),
		`export default {
			manifest: { id: "main", label: "main", icon: "puzzle", version: "0.0.0", apiGeneration: ${PLUGIN_API_GENERATION}, wireVersion: 1, enabledByDefault: false, dependsOn: [{ id: "dep", wireVersion: 1 }], contributes: { sideTools: [], fileViewers: [] } },
			contract: { id: "main", wireVersion: 1, methods: {}, channels: {}, settings: { type: "object", properties: {} } },
			activate: (ctx) => {
				const dep = ctx.dependency({ id: "dep" });
				return () => {
					// Record the moment this disposer *starts*, not when it finishes — an inter-plugin
					// call inside it takes extra microtask hops that would otherwise mask which disposer
					// actually ran first.
					globalThis.__disposeOrder.push("main");
					return dep.request("ping", {}).then(
						(result) => {
							globalThis.__depResultFromMain = result;
						},
						(err) => {
							globalThis.__depResultFromMain = { error: String(err) };
						},
					);
				};
			},
		};`,
	);
	writeFileSync(
		join(root, "dep", "host.js"),
		`export default {
			manifest: { id: "dep", label: "dep", icon: "puzzle", version: "0.0.0", apiGeneration: ${PLUGIN_API_GENERATION}, wireVersion: 1, enabledByDefault: false, dependsOn: [], contributes: { sideTools: [], fileViewers: [] } },
			contract: { id: "dep", wireVersion: 1, methods: { ping: { params: { type: "object", properties: {} }, result: { type: "object", properties: {} } } }, channels: {}, settings: { type: "object", properties: {} } },
			activate: (ctx) => {
				ctx.method("ping", () => ({ pong: true }));
				return () => { globalThis.__disposeOrder.push("dep"); };
			},
		};`,
	);
	(globalThis as { __disposeOrder?: string[] }).__disposeOrder = [];

	const runtime = await installPlugins(
		fixtureSeams(
			{},
			{ pluginPaths: [root], plugins: { dep: { enabled: true }, main: { enabled: true } } },
		),
	);
	expect(runtime.roster().find((entry) => entry.id === "main")?.status).toBe("active");

	runtime.dispose();
	await new Promise((resolve) => setTimeout(resolve, 20));

	expect((globalThis as { __disposeOrder?: string[] }).__disposeOrder).toEqual(["main", "dep"]);
});

test("validateSettings checks a namespace against the plugin's own settings schema, once it is active", async () => {
	const root = tempRoot();
	writeFixturePlugin(root, "fixture", {
		type: "object",
		properties: { theme: { type: "string" } },
	});
	const runtime = await installPlugins(
		fixtureSeams({}, { pluginPaths: [root], plugins: { fixture: { enabled: true } } }),
	);
	const next = runtime.validateSettings({ fixture: { enabled: true, theme: "light" } }, {});
	expect(next).toEqual({ fixture: { enabled: true, theme: "light" } });
});

test("validateSettings throws the refusal reason instead of returning it", async () => {
	const root = tempRoot();
	writeFixturePlugin(root, "fixture", {
		type: "object",
		properties: { theme: { type: "string" } },
		required: ["theme"],
	});
	const runtime = await installPlugins(
		fixtureSeams({}, { pluginPaths: [root], plugins: { fixture: { enabled: true } } }),
	);
	expect(() => runtime.validateSettings({ fixture: { enabled: true } }, {})).toThrow(
		"fixture settings",
	);
});
