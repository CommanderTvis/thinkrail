import { rmSync } from "node:fs";
import { basename, join } from "node:path";
import { git } from "../../../e2e/fixtures/git";
import { E2E_FIXTURE_REPO, E2E_PLAIN_DIR } from "../../../e2e/fixtures/paths";
import {
	createWorkspaceViaDialog,
	openAppFresh,
	openFixtureProject,
	stagePlainFolder,
	waitConnected,
	worktreeRows,
} from "./fixtures/app";
import { expect, test } from "./fixtures/native";

const FIXTURE_SPECS = ["SPEC.md", join("module-a", "SPEC.md")];

test("opens a clean ThinkRail with no projects imported", async ({ app }) => {
	await openAppFresh(app);

	await expect(app.getByTestId("welcome")).toBeShown();
	await expect(app.getByTestId("center-tabs")).toHaveElements(0);
	await expect(app.getByTestId("right-panel")).toHaveElements(0);
	await expect(app.getByTestId("terminal-panel")).toHaveElements(0);

	await expect(app.getByTestId("welcome-title")).toShowText("ThinkRail");
	await expect(app.getByTestId("welcome-cta")).toContainShownText("Open project");
	await expect(app.getByTestId("welcome-action")).toHaveElements(0);

	await app.getByTestId("welcome-cta").click();
	await expect(app.getByTestId("menu-open-project")).toBeShown();
});

test("the Welcome provider warning only shows when no provider is connected, and opens Settings", async ({
	app,
}) => {
	await openAppFresh(app);

	const banner = app.getByTestId("welcome-provider-warning");
	await expect(app.getByTestId("welcome")).toBeShown();
	if (await banner.isVisible()) {
		await expect(banner).toContainShownText("No model provider connected");
		await app.getByTestId("welcome-connect-provider").click();
		await expect(app.getByTestId("settings-dialog")).toBeShown();
		await expect(app.getByTestId("settings-providers")).toBeShown();
	} else {
		await expect(banner).toHaveElements(0);
	}
});

test("Settings → Providers lists in-app auth options", async ({ app }) => {
	await openAppFresh(app);

	await app.getByTestId("open-settings").click();
	await expect(app.getByTestId("settings-dialog")).toBeShown();
	await expect(app.getByTestId("settings-providers")).toBeShown();

	await expect
		.poll(async () => (await app.getByTestId("provider-row").count()) + (await app.getByTestId("provider-signin-row").count()))
		.toBeGreaterThan(0);
	await expect(app.getByTestId("providers-error")).toHaveElements(0);
});

test("a real provider's API key round-trips through the login dialog (add in Settings, sign out)", {
	tag: "@dev-seam",
}, async ({ app }) => {
	await openAppFresh(app);
	await app.getByTestId("open-settings").click();
	await expect(app.getByTestId("settings-providers")).toBeShown();

	const keyBtn = app.getByTestId("provider-apikey").first();
	await expect(keyBtn).toBeShown();
	const providerId = await keyBtn.getAttribute("provider");
	expect(providerId).toBeTruthy();
	await keyBtn.click();

	const dialog = app.getByTestId("login-dialog");
	await expect(dialog).toBeShown();
	for (let i = 0; i < 8; i++) {
		if (await app.getByTestId("login-success").isVisible()) break;
		const option = app.getByTestId("login-option").first();
		const input = app.getByTestId("login-input");
		if (await option.isVisible()) {
			await option.click();
		} else if (await input.isVisible()) {
			await input.fill(`e2e-dummy-${i}`);
			await app.getByTestId("login-submit").click();
		} else {
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
	}
	await expect(app.getByTestId("login-success")).toBeShown();
	await app.getByTestId("login-close").click();
	await expect(dialog).toHaveElements(0);

	const configuredRow = app
		.getByTestId("provider-row")
		.withAttr("provider", providerId ?? "")
		.withAttr("configured", "true");
	await expect(configuredRow).toBeShown();

	await app.getByTestId("provider-signout").withAttr("provider", providerId ?? "").click();
	await expect(configuredRow).toHaveElements(0);
});

test("clicking Sign in (Settings) opens the in-app login dialog, and Cancel dismisses it", {
	tag: "@dev-seam",
}, async ({ app }) => {
	await openAppFresh(app);
	await app.getByTestId("open-settings").click();
	await expect(app.getByTestId("settings-providers")).toBeShown();

	const signIn = app.getByTestId("provider-signin").first();
	await expect(signIn).toBeShown();
	await signIn.click();

	const dialog = app.getByTestId("login-dialog");
	await expect(dialog).toBeShown();

	await app.getByTestId("login-cancel").click();
	await expect(dialog).toHaveElements(0);
});

test("Settings → Providers offers JetBrains AI with host-authoritative Central guidance", async ({ app }) => {
	await openAppFresh(app);
	await app.getByTestId("open-settings").click();
	await expect(app.getByTestId("settings-providers")).toBeShown();

	const card = app.getByTestId("jetbrains-ai-card");
	await expect(card).toBeShown();
	await expect(card).toContainShownText("JetBrains AI");

	if ((await card.getAttribute("installed")) === "false") {
		await expect(app.getByTestId("jetbrains-needs-install")).toBeShown();
		await expect(app.getByTestId("jetbrains-connect")).toHaveElements(0);
	} else if ((await card.getAttribute("configured")) === "true") {
		await expect(app.getByTestId("jetbrains-disconnect")).toBeShown();
	} else {
		await expect(app.getByTestId("jetbrains-connect")).toBeShown();
	}
});

test("a project with specs offers Start building over Set up, beside the project-folder fork", async ({ app }) => {
	await openFixtureProject(app);
	await expect(app.getByTestId("welcome-title")).toShowText("sample-project");
	const scope = app.getByTestId("scope-context");
	await expect(scope).toHaveAttr("context", "project-home");
	await expect(scope).toContainShownText("sample-project");
	await expect(scope).toContainShownText("Project home");
	await expect(app.getByTestId("welcome-cta")).toContainShownText("Start building");
	await expect(app.getByTestId("welcome-action")).toHaveElements(1);
	await expect(app.getByTestId("welcome-action").filter({ hasText: "Work in project folder" })).toBeShown();
	await expect(app.getByTestId("welcome").filter({ hasText: "Set up project" })).toHaveElements(0);
	await expect(app.getByTestId("welcome").filter({ hasText: "Open project" })).toHaveElements(0);
});

test("a project without specs suggests setting it up", async ({ app }) => {
	for (const spec of FIXTURE_SPECS) rmSync(join(E2E_FIXTURE_REPO, spec), { force: true });
	try {
		await openFixtureProject(app);
		await expect(app.getByTestId("welcome-title")).toShowText("sample-project");
		await expect(app.getByTestId("welcome-cta")).toContainShownText("Set up project");
		await expect(app.getByTestId("welcome-action")).toHaveElements(2);
		await expect(app.getByTestId("welcome-action").filter({ hasText: "Start building" })).toBeShown();
		await expect(app.getByTestId("welcome-action").filter({ hasText: "Work in project folder" })).toBeShown();

		await app.getByTestId("welcome-cta").click();
		const dialog = app.getByTestId("new-workspace-dialog");
		await expect(dialog).toBeShown();
		await expect(dialog.getByTestId("ws-prompt")).toHaveInputValue("/skill:setting-up-a-project ");
		await expect(dialog.getByTestId("slash-menu")).toHaveElements(0);
		await expect(dialog.getByTestId("ws-target-worktree")).toHaveAttr("active", "true");
		await expect(dialog).toContainShownText("Create workspace");
		await expect(dialog.getByTestId("ws-branch-picker")).toBeShown();
		await expect(dialog.getByTestId("ws-prompt-note")).toContainShownText("setting-up-a-project skill");

		await dialog.getByTestId("ws-target-default").click();
		await expect(dialog).toContainShownText("Work in project folder");
		await expect(dialog).toContainShownText("no isolation");
		await expect(dialog.getByTestId("ws-branch-picker")).toHaveElements(0);

		await dialog.getByTestId("ws-prompt").fill("");
		await expect(app.getByTestId("create-workspace")).toShowText(/Start/);
		await app.getByTestId("create-workspace").click();
		await expect(dialog).not.toBeShown();
		await expect(app.getByTestId("welcome")).toHaveElements(0);
		await expect(app.getByTestId("center-tabs")).toBeShown();
		await expect(app.getByTestId("right-panel")).toBeShown();
		await expect(app.getByTestId("terminal-panel")).toBeShown();
		await expect(app.getByTestId("workspace-item").withAttr("kind", "default")).toHaveAttr("active", "true");
		await expect(worktreeRows(app)).toHaveElements(0);
	} finally {
		git(E2E_FIXTURE_REPO, "checkout", "--", ...FIXTURE_SPECS);
	}
});

test("opening a non-git folder from the Welcome screen offers to initialise a repo", async ({ app }) => {
	await stagePlainFolder();
	await app.relaunch();
	await waitConnected(app);
	await expect(app.getByTestId("welcome")).toBeShown();

	await app.getByTestId("welcome-cta").click();
	await app.getByTestId("menu-open-project").click();

	const confirmInit = app.getByTestId("confirm-init-repo");
	await expect(confirmInit).toBeShown();
	await confirmInit.click();

	await expect(app.getByTestId("project-item").filter({ hasText: basename(E2E_PLAIN_DIR) })).toBeShown();
	await expect(app.getByTestId("welcome")).toBeShown();
	await expect(app.getByTestId("center-tabs")).toHaveElements(0);
	await expect(app.getByTestId("welcome-title")).toShowText(basename(E2E_PLAIN_DIR));
	await expect(app.getByTestId("welcome-cta")).toContainShownText("Set up project");
	await expect(app.getByTestId("welcome-action").filter({ hasText: "Work in project folder" })).toBeShown();
});

test("clicking a project returns to its Welcome, deselecting the active workspace", async ({ app }) => {
	await openFixtureProject(app);
	await createWorkspaceViaDialog(app);
	await expect(app.getByTestId("center-tabs")).toBeShown();
	await expect(app.getByTestId("workspace-item").withAttr("active", "true")).toHaveElements(1);

	await app.getByTestId("project-item").first().click();
	await expect(app.getByTestId("welcome")).toBeShown();
	await expect(app.getByTestId("center-tabs")).toHaveElements(0);
	await expect(app.getByTestId("workspace-item").withAttr("active", "true")).toHaveElements(0);

	await worktreeRows(app).first().click();
	await expect(app.getByTestId("center-tabs")).toBeShown();
});
