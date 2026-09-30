import { realpathSync } from "node:fs";
import { E2E_FIXTURE_REPO } from "../../../e2e/fixtures/paths";
import { seedWorkspaceSession } from "../../../e2e/fixtures/sessions";
import { enterDefaultWorkspace, openFixtureProject, openPersistedChat, waitConnected } from "./fixtures/app";
import { expect, type NativeApp, test } from "./fixtures/native";

async function openResourceChat(app: NativeApp): Promise<void> {
	await openFixtureProject(app);
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "Resource UI",
		messages: [{ role: "user", text: "Inspect this chat's resources.", timestamp: Date.now() }],
	});
	await enterDefaultWorkspace(app);
	await openPersistedChat(app, "Resource UI");
	await expect(app.getByTestId("chat-toolbar")).toBeShown();
}

test("empty Resources popover preserves keyboard focus and stays usable at phone width", async ({ app }) => {
	await openResourceChat(app);
	const trigger = app.getByTestId("resources-trigger");
	await expect(trigger).toHaveAttr("active-count", "0");
	await expect(app.getByLabel("Resources, 0 active")).toBeShown();
	await trigger.click();
	const popover = app.getByTestId("resources-popover");
	await expect(popover).toBeShown();
	await expect(popover.getByTestId("resources-commands")).toBeShown();
	await expect(popover.getByTestId("resources-subagents")).toBeShown();
	await expect(popover.getByText("No active commands.", { exact: true })).toBeShown();
	await expect(popover.getByText("No active subagents.", { exact: true })).toBeShown();
	const finished = popover.getByTestId("resources-finished-toggle");
	await expect(finished).toShowText("Finished · 0");
	await expect(finished).toHaveAttr("expanded", "false");
	await expect(popover.getByTestId("resource-stop")).toHaveElements(0);
	await expect(popover.getByTestId("resources-stop-all")).toHaveElements(0);
	await popover.press("Escape");
	await expect(popover).not.toBeShown();
	await expect(trigger).toHaveAttr("open", "false");
});

test("Resources rehydrates on welcome after a real socket reconnect and browser reload", async ({ app, wire }) => {
	let reads = 0;
	wire.tap({
		toHost: (frame) => {
			if (frame.method === "session.resources") reads++;
			return undefined;
		},
	});
	await openResourceChat(app);
	const trigger = app.getByTestId("resources-trigger");
	await expect(trigger).toHaveAttr("active-count", "0");
	await expect.poll(() => reads).toBeGreaterThan(0);
	const initial = reads;
	wire.disconnect();
	await expect.poll(() => reads).toBeGreaterThan(initial);
	await waitConnected(app);
	await expect(trigger).toHaveAttr("active-count", "0");
	const reconnected = reads;
	await app.relaunch();
	await waitConnected(app);
	await enterDefaultWorkspace(app);
	await openPersistedChat(app, "Resource UI");
	await expect.poll(() => reads).toBeGreaterThan(reconnected);
	await expect(trigger).toHaveAttr("active-count", "0");
});
