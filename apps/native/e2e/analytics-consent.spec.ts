import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type AppConfig, type AppConfigUpdate, WS_CHANNELS } from "@thinkrail/contracts";
import { seedAnalyticsConsent } from "../../../e2e/fixtures/analyticsConsent";
import { E2E_DATA_DIR, E2E_PORT } from "../../../e2e/fixtures/paths";
import { waitConnected } from "./fixtures/app";
import { expect, type NativeApp, test } from "./fixtures/native";

const configPath = join(E2E_DATA_DIR, "config.json");
const HOST = `http://127.0.0.1:${E2E_PORT}`;
const ANALYTICS_COPY =
	"Share anonymous product usage and how you found ThinkRail. We never collect prompts, code, files, credentials, or account identity.";

function savedConfig(): AppConfig {
	return JSON.parse(readFileSync(configPath, "utf8")) as AppConfig;
}

function trackSettingsUpdates(app: NativeApp): AppConfigUpdate[] {
	const updates: AppConfigUpdate[] = [];
	app.wire.tap({
		toHost: (frame) => {
			const params = frame.params as { config?: AppConfigUpdate } | undefined;
			if (frame.method === "settings.update" && params?.config) updates.push(params.config);
			return undefined;
		},
	});
	return updates;
}

async function openPrivacy(app: NativeApp, legacy = false): Promise<void> {
	await waitConnected(app);
	await app.getByTestId("open-settings").click();
	await app.getByTestId("settings-nav-privacy").click();
	await expect(app.getByTestId("settings-privacy")).toBeShown();
	if (!legacy) await expect(app.getByTestId("settings-privacy")).toContainShownText(ANALYTICS_COPY);
}

async function waitForPrime(updates: AppConfigUpdate[]): Promise<void> {
	await expect.poll(() => updates).toEqual([{ analyticsEnabled: true }]);
	await expect.poll(() => savedConfig()).toMatchObject({ analyticsEnabled: true, analyticsConsentConfirmed: false });
}

test.afterEach(async () => {
	await seedAnalyticsConsent(HOST, false, true);
});

for (const enabled of [true, false]) {
	test(`first dialog primes on from saved ${enabled ? "on" : "off"} and Done confirms on`, async ({ app }) => {
		await seedAnalyticsConsent(HOST, enabled, false);
		const updates = trackSettingsUpdates(app);
		await app.relaunch();
		const dialog = app.getByTestId("analytics-consent-dialog");
		await expect(dialog).toBeShown();
		await expect(dialog.getByTestId("analytics-toggle")).toHaveAttr("active", "true");
		await expect(dialog).toContainShownText("Help improve ThinkRail");
		await expect(dialog).toContainShownText(ANALYTICS_COPY);
		await expect(dialog.getByTestId("analytics-consent-confirm")).toShowText("Done");
		await waitForPrime(updates);
		await dialog.getByTestId("analytics-consent-confirm").click();
		await expect(dialog).not.toBeShown();
		expect(updates).toEqual([{ analyticsEnabled: true }, { analyticsEnabled: true, analyticsConsentConfirmed: true }]);
		expect(savedConfig()).toMatchObject({ analyticsEnabled: true, analyticsConsentConfirmed: true });
		await app.relaunch({ keepPreferences: true });
		await openPrivacy(app);
		await expect(dialog).not.toBeShown();
		await expect(app.getByTestId("analytics-toggle")).toHaveAttr("active", "true");
	});
}

for (const dismissal of ["close", "escape", "backdrop"] as const) {
	test(`first-dialog ${dismissal} accepts the primed on choice`, async ({ app }) => {
		await seedAnalyticsConsent(HOST, false, false);
		const updates = trackSettingsUpdates(app);
		await app.relaunch();
		const dialog = app.getByTestId("analytics-consent-dialog");
		await expect(dialog).toBeShown();
		await waitForPrime(updates);
		if (dismissal === "close") await dialog.getByTestId("analytics-consent-close").click();
		else if (dismissal === "escape") await dialog.press("Escape");
		else await app.getByTestId("dialog-overlay").click();
		await expect(dialog).not.toBeShown();
		expect(updates).toEqual([{ analyticsEnabled: true }, { analyticsEnabled: true, analyticsConsentConfirmed: true }]);
		expect(savedConfig()).toMatchObject({ analyticsEnabled: true, analyticsConsentConfirmed: true });
	});
}

test("switching off immediately persists refusal and closes from the broadcast", async ({ app }) => {
	await seedAnalyticsConsent(HOST, false, false);
	const updates = trackSettingsUpdates(app);
	await app.relaunch();
	const dialog = app.getByTestId("analytics-consent-dialog");
	await expect(dialog).toBeShown();
	await waitForPrime(updates);
	await dialog.getByTestId("analytics-toggle").click();
	await expect(dialog).not.toBeShown();
	expect(updates).toEqual([{ analyticsEnabled: true }, { analyticsEnabled: false, analyticsConsentConfirmed: true }]);
	expect(savedConfig()).toMatchObject({ analyticsEnabled: false, analyticsConsentConfirmed: true });
});

function breakConfig(): () => void {
	const original = readFileSync(configPath, "utf8");
	rmSync(configPath);
	mkdirSync(configPath);
	return () => {
		rmSync(configPath, { recursive: true, force: true });
		writeFileSync(configPath, original);
	};
}

for (const action of ["done", "close"] as const) {
	test(`failed ${action} persistence keeps the on choice visible and retryable`, async ({ app }) => {
		await seedAnalyticsConsent(HOST, false, false);
		const updates = trackSettingsUpdates(app);
		await app.relaunch();
		const dialog = app.getByTestId("analytics-consent-dialog");
		await expect(dialog).toBeShown();
		await waitForPrime(updates);
		const restore = breakConfig();
		const actionControl =
			action === "done" ? dialog.getByTestId("analytics-consent-confirm") : dialog.getByTestId("analytics-consent-close");
		try {
			await actionControl.click();
			await expect(dialog.getByTestId("analytics-consent-error")).toContainShownText("Couldn't save your choice");
			await expect(dialog.getByTestId("analytics-toggle")).toHaveAttr("active", "true");
		} finally {
			restore();
		}
		await actionControl.click();
		await expect(dialog).not.toBeShown();
		expect(savedConfig()).toMatchObject({ analyticsEnabled: true, analyticsConsentConfirmed: true });
	});
}

test("failed immediate refusal stays off and Done retries it", async ({ app }) => {
	await seedAnalyticsConsent(HOST, false, false);
	const updates = trackSettingsUpdates(app);
	await app.relaunch();
	const dialog = app.getByTestId("analytics-consent-dialog");
	await expect(dialog).toBeShown();
	await waitForPrime(updates);
	const restore = breakConfig();
	try {
		await dialog.getByTestId("analytics-toggle").click();
		await expect(dialog.getByTestId("analytics-consent-error")).toContainShownText("Couldn't save your choice");
		await expect(dialog.getByTestId("analytics-toggle")).toHaveAttr("active", "false");
	} finally {
		restore();
	}
	await dialog.getByTestId("analytics-consent-confirm").click();
	await expect(dialog).not.toBeShown();
	expect(savedConfig()).toMatchObject({ analyticsEnabled: false, analyticsConsentConfirmed: true });
});

test("failed priming remains visible and Done can persist the on choice", async ({ app }) => {
	await seedAnalyticsConsent(HOST, false, false);
	const restore = breakConfig();
	const dialog = app.getByTestId("analytics-consent-dialog");
	try {
		await app.relaunch();
		await expect(dialog).toBeShown();
		await expect(dialog.getByTestId("analytics-consent-error")).toContainShownText("Couldn't save your choice");
		await expect(dialog.getByTestId("analytics-toggle")).toHaveAttr("active", "true");
	} finally {
		restore();
	}
	await dialog.getByTestId("analytics-consent-confirm").click();
	await expect(dialog).not.toBeShown();
	expect(savedConfig()).toMatchObject({ analyticsEnabled: true, analyticsConsentConfirmed: true });
});

test("confirmation closes a peer draft and later Settings changes converge across clients", async ({
	app,
	openObserver,
}) => {
	await seedAnalyticsConsent(HOST, false, false);
	const updates = trackSettingsUpdates(app);
	await app.relaunch();
	await waitForPrime(updates);
	const peer = await openObserver();
	const peerUpdates = trackSettingsUpdates(peer);
	await expect(peer.getByTestId("analytics-consent-dialog")).toBeShown();
	await app.getByTestId("analytics-consent-confirm").click();
	await expect(app.getByTestId("analytics-consent-dialog")).not.toBeShown();
	await expect(peer.getByTestId("analytics-consent-dialog")).not.toBeShown();
	await openPrivacy(app);
	await openPrivacy(peer);
	await expect(peer.getByTestId("analytics-toggle")).toHaveAttr("active", "true");
	await app.getByTestId("analytics-toggle").click();
	await expect(peer.getByTestId("analytics-toggle")).toHaveAttr("active", "false");
	await peer.getByTestId("analytics-toggle").click();
	await expect(app.getByTestId("analytics-toggle")).toHaveAttr("active", "true");
	expect(updates).toEqual([
		{ analyticsEnabled: true },
		{ analyticsEnabled: true, analyticsConsentConfirmed: true },
		{ analyticsEnabled: false, analyticsConsentConfirmed: true },
	]);
	expect(peerUpdates.filter((update) => update.analyticsConsentConfirmed)).toEqual([
		{ analyticsEnabled: true, analyticsConsentConfirmed: true },
	]);
});

for (const enabled of [true, false]) {
	test(`confirmed ${enabled ? "on" : "off"} never opens or primes`, async ({ app }) => {
		await seedAnalyticsConsent(HOST, enabled, true);
		const updates = trackSettingsUpdates(app);
		await app.relaunch();
		await waitConnected(app);
		await expect(app.getByTestId("analytics-consent-dialog")).not.toBeShown();
		expect(updates).toEqual([]);
		expect(savedConfig()).toMatchObject({ analyticsEnabled: enabled, analyticsConsentConfirmed: true });
	});
}

test("consent takes precedence over an addressed interview invitation", async ({ app, wire }) => {
	await seedAnalyticsConsent(HOST, false, false);
	await app.relaunch();
	await expect(app.getByTestId("analytics-consent-dialog")).toBeShown();
	wire.sendToApp({ channel: WS_CHANNELS.feedbackInterview, data: {} });
	await expect(app.getByTestId("interview-prompt-dialog")).not.toBeShown();
	await app.getByTestId("analytics-consent-confirm").click();
	await expect(app.getByTestId("analytics-consent-dialog")).not.toBeShown();
	await expect(app.getByTestId("interview-prompt-dialog")).toBeShown();
});
