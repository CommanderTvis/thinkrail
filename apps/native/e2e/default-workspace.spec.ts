import {
	createWorkspaceViaDialog,
	defaultWorkspaceRow,
	enterDefaultWorkspace,
	goProjectHome,
	openFixtureProject,
	openWorkspaceMenu,
	runInTerminal,
	visibleTerminalScreen,
	waitTerminalReady,
	worktreeRows,
} from "./fixtures/app";
import { expect, test } from "./fixtures/native";

test("the Welcome fork's “Work in project folder” enters the Default workspace — the project folder itself", async ({ app }) => {
	await openFixtureProject(app);

	await enterDefaultWorkspace(app);

	await expect(app.getByTestId("center-tabs")).toBeShown();
	await expect(app.getByTestId("scope-name")).toShowText("Default");
	await expect(app.getByTestId("scope-branch")).toShowText("main");
	await expect(app.getByTestId("scope-base")).toHaveElements(0);

	const row = defaultWorkspaceRow(app);
	await expect(app.getByTestId("workspace-item").first()).toHaveAttr("kind", "default");
	await expect(row.getByTestId("workspace-name")).toShowText("Default");
	await expect(row.getByTestId("workspace-branch")).toShowText("main");

	const ready = app.getByTestId("workspace-ready");
	await expect(ready).toContainShownText("Default workspace");
	await expect(ready).toContainShownText("sample-project");
	await expect(ready).toContainShownText("on main");
	await expect(ready).toContainShownText("run directly in your project folder");

	await app.getByTestId("tab-files").click();
	await expect(app.getByTestId("file-node").withAttr("path", "README.md")).toBeShown();

	await app.getByTestId("tab-changes").click();
	await expect(app.getByTestId("changes-empty")).toBeShown();

	await app.getByTestId("terminal-tab").click();
	await waitTerminalReady(app);
	await runInTerminal(app, 'basename "$(pwd)"');
	await expect(visibleTerminalScreen(app)).toContainShownText("sample-project");
});

test("a terminal branch switch converges every Default branch label live", async ({ app }) => {
	await openFixtureProject(app);
	await enterDefaultWorkspace(app);

	const row = defaultWorkspaceRow(app);
	await expect(app.getByTestId("scope-branch")).toShowText("main");
	await expect(row.getByTestId("workspace-branch")).toShowText("main");

	await waitTerminalReady(app);
	await runInTerminal(app, "git switch -c live-branch");

	await expect(row.getByTestId("workspace-branch")).toShowText("live-branch");
	await expect(app.getByTestId("scope-branch")).toShowText("live-branch");
	await expect(app.getByTestId("workspace-ready")).toContainShownText("on live-branch");
});

test("the Default workspace is non-removable and unique; project home stays reachable", async ({ app }) => {
	await openFixtureProject(app);

	await createWorkspaceViaDialog(app);
	const row = defaultWorkspaceRow(app);
	await openWorkspaceMenu(row);
	await expect(app.getByTestId("workspace-actions")).toBeShown();
	await expect(app.getByTestId("workspace-remove")).toHaveElements(0);
	await app.getByTestId("workspace-actions").press("Escape");
	await openWorkspaceMenu(worktreeRows(app).first());
	await expect(app.getByTestId("workspace-remove")).toBeShown();
	await app.getByTestId("workspace-actions").press("Escape");

	await app.getByTestId("add-project-menu").click();
	await app.getByTestId("menu-open-project").click();
	await expect(app.getByTestId("welcome")).toBeShown();
	await expect(defaultWorkspaceRow(app)).toHaveElements(1);

	await defaultWorkspaceRow(app).click();
	await expect(app.getByTestId("center-tabs")).toBeShown();
	await expect(defaultWorkspaceRow(app)).toHaveAttr("active", "true");
	await goProjectHome(app);
	await expect(app.getByTestId("center-tabs")).toHaveElements(0);
});
