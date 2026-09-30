import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { E2E_EDITOR_LOG } from "../../../e2e/fixtures/paths";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	openWorkspaceMenu,
	renameInput,
	waitTerminalReady,
	worktreeRows,
} from "./fixtures/app";
import { expect, type NativeApp, test } from "./fixtures/native";

test.beforeEach(() => {
	rmSync(E2E_EDITOR_LOG, { force: true });
});

async function settleAfterCreate(app: NativeApp): Promise<void> {
	await waitTerminalReady(app);
}

test("Open in launches the detected editor detached at the worktree path", async ({ app }) => {
	await openFixtureProject(app);
	await createWorkspaceViaDialog(app);
	await settleAfterCreate(app);
	const row = worktreeRows(app).first();

	await openWorkspaceMenu(row);
	await app.getByTestId("workspace-open-in").click();
	const vsCode = app.getByTestId("workspace-open-in-editor").filter({ hasText: "VS Code" });
	await expect(vsCode).toBeShown();
	await vsCode.click();

	await expect.poll(() => existsSync(E2E_EDITOR_LOG)).toBe(true);
	const invocation = readFileSync(E2E_EDITOR_LOG, "utf8").trim();
	expect(invocation).toContain("/worktrees/sample-project/");
});

test("Copy path copies the worktree's absolute path to the clipboard", async ({ app }) => {
	await openFixtureProject(app);
	await createWorkspaceViaDialog(app);
	await settleAfterCreate(app);
	const row = worktreeRows(app).first();

	await openWorkspaceMenu(row);
	await app.getByTestId("workspace-copy-path").click();
	const copied = await app.clipboard();
	expect(copied).toContain("/worktrees/sample-project/");
});

test("a managed workspace can rename its display label inline without changing Git", async ({ app }) => {
	await openFixtureProject(app);
	const created = await createWorkspaceViaDialog(app);
	await settleAfterCreate(app);
	const row = worktreeRows(app).first();

	await openWorkspaceMenu(row);
	await app.getByTestId("workspace-rename").click();
	let input = renameInput(row);
	await expect(input).toHaveInputValue(created.name);
	await expect.poll(() => app.focusedSelection()).toEqual({ start: 0, end: created.name.length, text: created.name });
	await input.fill("   ");
	await app.getByTestId("project-name").first().click();
	await expect(row.getByTestId("workspace-name")).toShowText(created.name);

	await openWorkspaceMenu(row);
	await app.getByTestId("workspace-rename").click();
	input = renameInput(row);
	await input.fill("Cancelled Rename");
	await input.press("Escape");
	await expect(row.getByTestId("workspace-name")).toShowText(created.name);

	await openWorkspaceMenu(row);
	await app.getByTestId("workspace-rename").click();
	input = renameInput(row);
	await input.fill("Manual Workspace Name");
	await app.getByTestId("project-name").first().click();

	await expect(row.getByTestId("workspace-name")).toShowText("Manual Workspace Name");
	await expect(row.getByTestId("workspace-branch")).toShowText(created.branch);
	expect(
		execFileSync("git", ["-C", created.worktreePath, "symbolic-ref", "--short", "HEAD"], {
			encoding: "utf8",
		}).trim(),
	).toBe(created.branch);
	expect(existsSync(created.worktreePath)).toBe(true);
});

test("an open inline rename survives reconnect", async ({ app, wire }) => {
	await openFixtureProject(app);
	const created = await createWorkspaceViaDialog(app);
	await settleAfterCreate(app);
	const row = worktreeRows(app).first();
	await openWorkspaceMenu(row);
	await app.getByTestId("workspace-rename").click();
	const input = renameInput(row);
	await expect(input).toBeShown();

	const releaseReconnect = wire.holdReconnects();
	wire.disconnect();
	await expect(app.getByTestId("connection-status")).not.toHaveAttr("status", "connected");
	await expect(input).toBeShown();
	await input.fill("Rename After Reconnect");
	await input.press("Enter");
	await expect(input).toBeShown();
	await expect(input).toHaveInputValue("Rename After Reconnect");

	releaseReconnect();
	await expect(app.getByTestId("connection-status")).toHaveAttr("status", "connected");
	await expect.poll(() => wire.connections).toBeGreaterThan(1);
	await expect(row.getByTestId("workspace-name")).toShowText("Rename After Reconnect");
	await expect(row.getByTestId("workspace-branch")).toShowText(created.branch);
});

test("the Default workspace's kebab menu offers only non-mutating actions", async ({ app }) => {
	await openFixtureProject(app);
	const row = app.getByTestId("workspace-item").withAttr("kind", "default");
	await openWorkspaceMenu(row);
	await expect(app.getByTestId("workspace-open-in")).toBeShown();
	await expect(app.getByTestId("workspace-copy-path")).toBeShown();
	await expect(app.getByTestId("workspace-rename")).toHaveElements(0);
	await expect(app.getByTestId("workspace-remove")).toHaveElements(0);
});

test("right-click opens the workspace's kebab menu without activating it", async ({ app }) => {
	await openFixtureProject(app);
	await createWorkspaceViaDialog(app);
	await settleAfterCreate(app);

	const activeRow = worktreeRows(app).first();
	const defaultRow = app.getByTestId("workspace-item").withAttr("kind", "default");
	await expect(activeRow).toHaveAttr("active", "true");
	await expect(defaultRow).toHaveAttr("active", "false");

	const rowBox = await defaultRow.boundingBox();
	await defaultRow.click({ button: "right", position: { x: rowBox.x + 4, y: rowBox.y + rowBox.height / 2 } });
	const actions = app.getByTestId("workspace-actions");
	await expect(actions).toBeShown();
	const [actionsBox, kebabBox] = await Promise.all([
		actions.boundingBox(),
		defaultRow.getByTestId("workspace-menu").boundingBox(),
	]);
	expect(Math.abs(actionsBox.x + actionsBox.width - (kebabBox.x + kebabBox.width))).toBeLessThan(8);
	expect(Math.abs(actionsBox.y - (kebabBox.y + kebabBox.height))).toBeLessThan(12);
	await expect(app.getByTestId("workspace-copy-path")).toBeShown();
	await expect(app.getByTestId("workspace-rename")).toHaveElements(0);
	await expect(app.getByTestId("workspace-remove")).toHaveElements(0);
	await expect(activeRow).toHaveAttr("active", "true");
	await expect(defaultRow).toHaveAttr("active", "false");
});

test("the kebab is hover-only ONLY on devices that actually have hover — never invisible by default", async ({
	app,
}) => {
	await openFixtureProject(app);
	await createWorkspaceViaDialog(app);
	await settleAfterCreate(app);
	const row = worktreeRows(app).first();
	const kebab = row.getByTestId("workspace-menu");

	await expect(kebab).toHaveAttr("visible", "false");
	await row.hover();
	await expect(kebab).toHaveAttr("visible", "true");
});
