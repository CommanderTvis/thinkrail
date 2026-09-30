import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { git } from "../../../e2e/fixtures/git";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO, E2E_PICK_DIR_POINTER, E2E_PLAIN_DIR } from "../../../e2e/fixtures/paths";
import {
	createWorkspaceViaDialog,
	defaultWorkspaceRow,
	openAppFresh,
	openFixtureProject,
	stagePlainFolder,
	waitConnected,
	worktreeRows,
} from "./fixtures/app";
import { expect, type NativeApp, type NativeLocator, test } from "./fixtures/native";
import { signal, type WireProxy } from "./fixtures/wire";

function holdNextPickerReply(wire: WireProxy, pickerPath: string) {
	const held = signal();
	const release = signal();
	const barrier = signal();
	let pickerRequestId: unknown = null;
	let barrierArmed = false;
	let staleOpenSent = false;
	const untap = wire.tap({
		toHost: (frame) => {
			if (frame.method === "dialog.selectDirectory") pickerRequestId = frame.id;
			if (barrierArmed) {
				const params = frame.params as Record<string, unknown> | undefined;
				if (frame.method === "project.open" && params?.path === pickerPath) staleOpenSent = true;
				if (frame.method === "provider.status") barrier.send();
			}
			return undefined;
		},
		toApp: (frame, _raw, deliver) => {
			if (pickerRequestId === null || frame.id !== pickerRequestId) return undefined;
			held.send();
			void release.received.then(deliver);
			return "hold";
		},
	});
	return {
		held: held.received,
		release: release.send,
		armBarrier: () => {
			barrierArmed = true;
		},
		barrier: barrier.received,
		staleOpenWasSent: () => staleOpenSent,
		untap,
	};
}

async function openProjectActions(app: NativeApp, row: NativeLocator): Promise<NativeLocator> {
	await row.click({ button: "right" });
	const menu = app.getByTestId("project-actions");
	await expect(menu).toBeShown();
	return menu;
}

function seedSecondRepo(): string {
	const repo = join(E2E_DATA_DIR, "second-project");
	rmSync(repo, { recursive: true, force: true });
	mkdirSync(repo, { recursive: true });
	git(repo, "init", "-b", "main");
	git(repo, "config", "user.email", "e2e@thinkrail.test");
	git(repo, "config", "user.name", "ThinkRail E2E");
	git(repo, "config", "commit.gpgsign", "false");
	writeFileSync(join(repo, "README.md"), "# second project\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "seed");
	writeFileSync(E2E_PICK_DIR_POINTER, repo);
	return repo;
}

function projectRow(app: NativeApp, name: string): NativeLocator {
	return app.getByTestId("project-item").filter({ hasText: name });
}

async function workspaceRowsOf(app: NativeApp, name: string): Promise<NativeLocator> {
	const id = await projectRow(app, name).getAttribute("id");
	return app.getByTestId("workspace-item").withAttr("project", id ?? "");
}

test("opens a git repo as a project via the directory picker", async ({ app }) => {
	await app.relaunch();
	await waitConnected(app);

	await app.getByTestId("add-project-menu").click();
	await app.getByTestId("menu-open-project").click();

	await expect(projectRow(app, basename(E2E_FIXTURE_REPO))).toBeShown();
});

test("opens a project from an explicit host path", async ({ app }) => {
	await app.relaunch();
	await waitConnected(app);

	await app.getByTestId("add-project-menu").click();
	await app.getByTestId("menu-enter-host-path").click();

	const dialog = app.getByTestId("open-project-path-dialog");
	await expect(dialog).toBeShown();
	await expect(dialog).toContainShownText("computer running ThinkRail");
	await expect(dialog.getByTestId("open-project-picker-error")).toHaveElements(0);
	const input = dialog.getByTestId("open-project-path-input");
	await input.fill(E2E_FIXTURE_REPO);
	await input.press("Enter");

	await expect(dialog).toHaveElements(0);
	await expect(projectRow(app, basename(E2E_FIXTURE_REPO))).toBeShown();
});

test("picker failure falls back to host-path entry on every host platform", async ({ app }) => {
	const failure = "Deterministic picker failure from the e2e host";
	writeFileSync(E2E_PICK_DIR_POINTER, `error:${failure}`);
	try {
		await app.relaunch();
		await waitConnected(app);

		await app.getByTestId("add-project-menu").click();
		await app.getByTestId("menu-open-project").click();

		const dialog = app.getByTestId("open-project-path-dialog");
		await expect(dialog).toBeShown();
		await expect(dialog.getByTestId("open-project-picker-error")).toContainShownText(failure);
		await dialog.getByTestId("open-project-path-input").fill(E2E_FIXTURE_REPO);
		await dialog.getByTestId("open-project-path-submit").click();

		await expect(dialog).toHaveElements(0);
		await expect(projectRow(app, basename(E2E_FIXTURE_REPO))).toBeShown();
	} finally {
		writeFileSync(E2E_PICK_DIR_POINTER, E2E_FIXTURE_REPO);
	}
});

test("manual path from the rail supersedes a picker started from Welcome", async ({ app, wire }) => {
	const pickerReply = holdNextPickerReply(wire, E2E_FIXTURE_REPO);
	try {
		await openAppFresh(app);
		const manualRepo = seedSecondRepo();
		writeFileSync(E2E_PICK_DIR_POINTER, E2E_FIXTURE_REPO);

		await app.getByTestId("welcome-cta").click();
		await app.getByTestId("menu-open-project").click();
		await pickerReply.held;

		await app.getByTestId("add-project-menu").click();
		await app.getByTestId("menu-enter-host-path").click();
		const pathDialog = app.getByTestId("open-project-path-dialog");
		await pathDialog.getByTestId("open-project-path-input").fill(manualRepo);
		await pathDialog.getByTestId("open-project-path-submit").click();
		await expect(app.getByTestId("welcome-title")).toShowText("second-project");

		pickerReply.release();
		pickerReply.armBarrier();
		await app.getByTestId("open-settings").click();
		await pickerReply.barrier;
		expect(pickerReply.staleOpenWasSent()).toBe(false);
		await app.getByTestId("settings-dialog").press("Escape");
		await expect(app.getByTestId("settings-dialog")).toHaveElements(0);
		await expect(app.getByTestId("welcome-title")).toShowText("second-project");
		await expect(projectRow(app, basename(E2E_FIXTURE_REPO))).toHaveElements(0);
	} finally {
		pickerReply.untap();
	}
});

test("opening a non-git folder offers to initialise a repo, then opens it end-to-end", async ({ app }) => {
	await stagePlainFolder();
	await app.relaunch();
	await waitConnected(app);

	await app.getByTestId("add-project-menu").click();
	await app.getByTestId("menu-open-project").click();
	const confirmInit = app.getByTestId("confirm-init-repo");
	await expect(confirmInit).toBeShown();
	await confirmInit.click();

	await expect(projectRow(app, basename(E2E_PLAIN_DIR))).toBeShown();

	await createWorkspaceViaDialog(app);
	await expect(worktreeRows(app).first()).toBeShown();
});

test("rail expansion is per-browser view state that survives a reload", async ({ app }) => {
	await openFixtureProject(app);
	const expand = projectRow(app, "sample-project").getByTestId("project-expand");

	await expect(expand).toHaveAttr("expanded", "true");
	await expect(defaultWorkspaceRow(app)).toBeShown();

	await app.relaunch({ keepPreferences: true });
	await waitConnected(app);
	await expect(expand).toHaveAttr("expanded", "true");
	await expect(defaultWorkspaceRow(app)).toBeShown();

	await expand.click();
	await expect(expand).toHaveAttr("expanded", "false");
	await app.relaunch({ keepPreferences: true });
	await waitConnected(app);
	await expect(expand).toHaveAttr("expanded", "false");
	await expect(defaultWorkspaceRow(app)).toHaveElements(0);
});

test("activating a workspace in one project keeps the other project's rail expansion", async ({ app }) => {
	await openFixtureProject(app);
	seedSecondRepo();
	await app.getByTestId("add-project-menu").click();
	await app.getByTestId("menu-open-project").click();

	const fixtureExpand = projectRow(app, "sample-project").getByTestId("project-expand");
	const secondExpand = projectRow(app, "second-project").getByTestId("project-expand");
	await expect(secondExpand).toHaveAttr("expanded", "true");
	await expect(fixtureExpand).toHaveAttr("expanded", "true");

	const fixtureDefaultRow = (await workspaceRowsOf(app, "sample-project")).withAttr("kind", "default");
	await fixtureDefaultRow.click();
	await expect(fixtureDefaultRow).toHaveAttr("active", "true");
	await expect(app.getByTestId("center-tabs")).toBeShown();

	await expect(secondExpand).toHaveAttr("expanded", "true");
	await expect(fixtureExpand).toHaveAttr("expanded", "true");
});

test("project context actions stay compact and close/reopen is lossless across clients", async ({
	app,
	openObserver,
}) => {
	await openFixtureProject(app);
	const workspace = await createWorkspaceViaDialog(app);

	const fixtureRow = projectRow(app, "sample-project");
	const expand = fixtureRow.getByTestId("project-expand");
	const addWorkspace = fixtureRow.getByTestId("add-workspace");
	await expect(expand).toBeShown();
	await expect(addWorkspace).toBeShown();
	await expect(fixtureRow.getByTestId("close-project")).toHaveElements(0);
	await expect(fixtureRow.getByLabel("Project actions")).toHaveElements(0);

	await expand.click();
	const count = fixtureRow.getByTestId("project-workspace-count");
	await expect(count).toShowText("1");

	const projectActions = app.getByTestId("project-actions");
	const fixtureBox = await fixtureRow.boundingBox();
	const pointer = { x: fixtureBox.x + 72, y: fixtureBox.y + fixtureBox.height / 2 };
	await fixtureRow.click({ button: "right", position: pointer });
	await expect(projectActions).toBeShown();
	await expect(fixtureRow).toHaveAttr("menu-open", "true");
	await expect(app.getByTestId("center-tabs")).toBeShown();
	const menuBox = await projectActions.boundingBox();
	expect(Math.abs(menuBox.x - pointer.x)).toBeLessThan(8);
	expect(Math.abs(menuBox.y - pointer.y)).toBeLessThan(8);

	await expect(projectActions.getByTestId("project-menu-create-workspace")).toShowText("Create workspace");
	await expect(projectActions.getByTestId("project-menu-open-existing-worktree")).toShowText(
		"Open existing worktree…",
	);
	await expect(projectActions.getByTestId("project-menu-close")).toShowText("Close project");
	await projectActions.press("Escape");
	await expect(projectActions).toHaveElements(0);
	await expect(fixtureRow).toHaveAttr("menu-open", "false");

	await fixtureRow.longPress(pointer);
	await expect(projectActions).toBeShown();
	await projectActions.press("Escape");

	await openProjectActions(app, fixtureRow);
	await app.getByTestId("project-menu-create-workspace").click();
	await expect(app.getByTestId("new-workspace-dialog")).toBeShown();
	await app.getByTestId("new-workspace-dialog").press("Escape");
	await expect(app.getByTestId("new-workspace-dialog")).toHaveElements(0);

	const secondRepo = seedSecondRepo();
	await app.getByTestId("add-project-menu").click();
	await app.getByTestId("menu-open-project").click();
	await expect(app.getByTestId("welcome-title")).toShowText("second-project");

	const observer = await openObserver();
	await waitConnected(observer);
	await expect(observer.getByTestId("welcome-title")).toShowText("second-project");

	const secondRow = projectRow(app, "second-project");
	await openProjectActions(app, secondRow);
	await app.getByTestId("project-menu-close").click();
	const confirm = app.getByTestId("confirm-dialog");
	await expect(confirm).toBeShown();
	await expect(confirm).toContainShownText("Close second-project?");
	await expect(confirm).toContainShownText(
		"Removes this project from the open projects list. Its repository, workspaces, chats, and running activity are kept. Reopen it from Add project → Recents.",
	);
	await confirm.getByTestId("confirm-cancel").click();
	await expect(secondRow).toBeShown();

	await openProjectActions(app, secondRow);
	await app.getByTestId("project-menu-close").click();
	await app.getByTestId("dialog-overlay").click();
	await expect(confirm).toHaveElements(0);
	await openProjectActions(app, secondRow);
	await app.getByTestId("project-menu-close").click();
	await expect(confirm).toBeShown();
	await confirm.press("Escape");
	await expect(confirm).toHaveElements(0);

	await openProjectActions(app, secondRow);
	await app.getByTestId("project-menu-close").click();
	await app.getByTestId("confirm-close-project").click();
	await expect(secondRow).toHaveElements(0);
	await expect(projectRow(observer, "second-project")).toHaveElements(0);
	await expect(app.getByTestId("welcome-title")).toShowText("sample-project");
	await expect(observer.getByTestId("welcome-title")).toShowText("sample-project");
	await expect(app.getByTestId("center-tabs")).toHaveElements(0);

	await openProjectActions(app, projectRow(app, "sample-project"));
	await app.getByTestId("project-menu-close").click();
	await app.getByTestId("confirm-close-project").click();
	await expect(app.getByTestId("project-item")).toHaveElements(0);
	await expect(observer.getByTestId("project-item")).toHaveElements(0);
	await expect(app.getByTestId("welcome-title")).toShowText("ThinkRail");
	await expect(observer.getByTestId("welcome-title")).toShowText("ThinkRail");

	await app.getByTestId("add-project-menu").click();
	const fixtureRecent = app.getByTestId("recent-project").filter({ hasText: E2E_FIXTURE_REPO });
	await expect(fixtureRecent).toBeShown();
	await expect(app.getByTestId("recent-project").filter({ hasText: secondRepo })).toBeShown();
	await fixtureRecent.click();
	await expect(app.getByTestId("welcome-title")).toShowText("sample-project");
	await expect(projectRow(observer, "sample-project")).toBeShown();
	await expect(observer.getByTestId("welcome-title")).toShowText("sample-project");
	await expect(app.getByTestId("center-tabs")).toHaveElements(0);
	await expect(worktreeRows(app).filter({ hasText: workspace.name })).toBeShown();

	await openAppFresh(app);
});
