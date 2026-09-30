import type { AppConfig, ModelDefault } from "@thinkrail/contracts";
import { E2eWire } from "../../../e2e/fixtures/wire";
import { chatTabs, enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import { expect, type NativeApp, test } from "./fixtures/native";

type SavedDefaults = Pick<AppConfig, "defaultModel" | "defaultEffort">;

const MODEL_ID = "e2e-central-model";

async function withHostWire<T>(run: (wire: E2eWire) => Promise<T>): Promise<T> {
	const wire = await E2eWire.connect();
	try {
		return await run(wire);
	} finally {
		wire.close();
	}
}

async function readDefaults(): Promise<SavedDefaults> {
	const config = await withHostWire((wire) => wire.request("settings.update", { config: {} }));
	return {
		...(config.defaultModel ? { defaultModel: config.defaultModel } : {}),
		...(config.defaultEffort ? { defaultEffort: config.defaultEffort } : {}),
	};
}

async function restoreDefaults(defaults: SavedDefaults): Promise<void> {
	await withHostWire((wire) =>
		wire.request("settings.update", {
			config: { defaultModel: defaults.defaultModel ?? null, defaultEffort: defaults.defaultEffort ?? null },
		}),
	);
}

async function openProviders(app: NativeApp): Promise<void> {
	await app.getByTestId("open-settings").click();
	await app.getByTestId("settings-nav-providers").click();
	await expect(app.getByTestId("settings-providers")).toBeShown();
}

async function connectFixtureProvider(app: NativeApp): Promise<void> {
	await openProviders(app);
	const card = app.getByTestId("jetbrains-ai-card");
	await expect(card).toHaveAttr("state", "supported", { timeout: 15_000 });
	await app.getByTestId("jetbrains-connect").click();
	await expect(card).toHaveAttr("state", "configured", { timeout: 15_000 });
}

async function disconnectFixtureProvider(app: NativeApp): Promise<void> {
	await openProviders(app);
	await app.getByTestId("jetbrains-disconnect").click();
	await expect(app.getByTestId("jetbrains-ai-card")).toHaveAttr("state", "supported", { timeout: 15_000 });
}

async function openFreshChat(app: NativeApp): Promise<void> {
	const previous = await chatTabs(app).count();
	await app.getByTestId("new-chat").click();
	await expect(chatTabs(app)).toHaveElements(previous + 1);
}

test("Models settings save host defaults and apply them to a fresh chat", async ({ app }) => {
	await openFixtureProject(app);
	await enterDefaultWorkspace(app);
	const defaults = await readDefaults();

	try {
		await connectFixtureProvider(app);
		const dialog = app.getByTestId("settings-dialog");
		await app.getByTestId("settings-nav-models").click();
		const section = app.getByTestId("settings-models");
		await expect(section).toContainShownText("Default model");
		await expect(section).toContainShownText("If it's unavailable, new chats use the first available model.");

		const modelSelector = section.getByTestId("model-selector");
		await modelSelector.click();
		await app.getByTestId("model-option").withAttr("model-id", MODEL_ID).click();

		await expect.poll(() => readDefaults()).toMatchObject({ defaultModel: { provider: "e2e-central", id: MODEL_ID } });
		const modelName = (await withHostWire((wire) => wire.request("model.default", {}))).model?.name ?? "";
		expect(modelName).not.toBe("");
		await expect(modelSelector).toContainShownText(modelName);

		const effortSelector = section.getByTestId("thinking-selector");
		await expect(effortSelector).toHaveAttr("disabled", "false");
		await effortSelector.click();
		await app.getByTestId("thinking-option").withAttr("level", "high").click();
		await expect(effortSelector).toContainShownText("high");

		await expect
			.poll(() => readDefaults())
			.toMatchObject({ defaultModel: { provider: "e2e-central", id: MODEL_ID }, defaultEffort: "high" });
		expect(await withHostWire((wire) => wire.request("model.default", {}))).toMatchObject({
			model: { provider: "e2e-central", id: MODEL_ID },
			thinkingLevel: "high",
		});

		await dialog.press("Escape");
		await openFreshChat(app);
		await expect(app.getByTestId("model-selector").last()).toContainShownText(modelName);
		await expect(app.getByTestId("thinking-selector").last()).toContainShownText("high");

		await disconnectFixtureProvider(app);
	} finally {
		await restoreDefaults(defaults);
	}
});

test("without saved defaults, Settings and a fresh chat use the first available model and clamped medium effort", async ({
	app,
}) => {
	await openFixtureProject(app);
	await enterDefaultWorkspace(app);
	const defaults = await readDefaults();

	try {
		await connectFixtureProvider(app);
		const dialog = app.getByTestId("settings-dialog");
		await dialog.press("Escape");
		const resolved = await withHostWire(async (wire): Promise<ModelDefault> => {
			const config = await wire.request("settings.update", { config: { defaultModel: null, defaultEffort: null } });
			expect(config).not.toHaveProperty("defaultModel");
			expect(config).not.toHaveProperty("defaultEffort");
			return wire.request("model.default", {});
		});
		expect(resolved.model).not.toBeNull();
		const modelName = resolved.model?.name ?? "";

		await openProviders(app);
		await app.getByTestId("settings-nav-models").click();
		const section = app.getByTestId("settings-models");
		await expect(section.getByTestId("model-selector")).toContainShownText(modelName);
		await expect(section.getByTestId("thinking-selector")).toContainShownText(resolved.thinkingLevel);

		await dialog.press("Escape");
		await openFreshChat(app);
		await expect(app.getByTestId("model-selector").last()).toContainShownText(modelName);
		await expect(app.getByTestId("thinking-selector").last()).toContainShownText(resolved.thinkingLevel);

		await disconnectFixtureProvider(app);
	} finally {
		await restoreDefaults(defaults);
	}
});
