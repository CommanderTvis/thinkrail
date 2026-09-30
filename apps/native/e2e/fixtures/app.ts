import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Workspace } from "@thinkrail/contracts";
import { disposeLiveSessionsOnPort, loadPersistedWorkspaces, resetState } from "../../../../e2e/fixtures/app";
import { E2E_PICK_DIR_POINTER, E2E_PLAIN_DIR, E2E_PORT } from "../../../../e2e/fixtures/paths";
import { expect, type NativeApp, type NativeLocator } from "./native";

export async function waitConnected(app: NativeApp): Promise<void> {
	await expect(app.getByTestId("connection-status")).toHaveAttr("status", "connected", { timeout: 20_000 });
}

export async function openAppFresh(app: NativeApp): Promise<void> {
	await disposeLiveSessionsOnPort(E2E_PORT);
	resetState();
	await app.relaunch();
	await waitConnected(app);
}

export async function stagePlainFolder(): Promise<string> {
	await disposeLiveSessionsOnPort(E2E_PORT);
	resetState();
	rmSync(E2E_PLAIN_DIR, { recursive: true, force: true });
	mkdirSync(E2E_PLAIN_DIR, { recursive: true });
	writeFileSync(join(E2E_PLAIN_DIR, "notes.txt"), "hello from a plain folder\n");
	writeFileSync(E2E_PICK_DIR_POINTER, E2E_PLAIN_DIR);
	return E2E_PLAIN_DIR;
}

export function defaultWorkspaceRow(app: NativeApp): NativeLocator {
	return app.getByTestId("workspace-item").withAttr("kind", "default");
}

export function worktreeRows(app: NativeApp): NativeLocator {
	return app.getByTestId("workspace-item").withoutAttr("kind", "default");
}

export function activeWorktreeRow(app: NativeApp): NativeLocator {
	return worktreeRows(app).withAttr("active", "true");
}

export function chatTabs(app: NativeApp): NativeLocator {
	return app.getByTestId("editor-tab").withAttr("kind", "chat");
}

export async function openFixtureProject(app: NativeApp): Promise<void> {
	await openAppFresh(app);
	await app.getByTestId("add-project-menu").click();
	await app.getByTestId("menu-open-project").click();
	await expect(app.getByTestId("project-item").first()).toBeShown();
	await expect(app.getByTestId("welcome")).toBeShown();
	await expect(defaultWorkspaceRow(app)).toBeShown();
}

export async function createWorkspaceViaDialog(app: NativeApp): Promise<Workspace> {
	const before = new Set(loadPersistedWorkspaces().map((workspace) => workspace.id));
	const dialog = app.getByTestId("new-workspace-dialog");
	await expect(async () => {
		if (!(await dialog.isVisible())) await app.getByTestId("add-workspace").first().click();
		await expect(dialog).toBeShown({ timeout: 5_000 });
	}).toPass({ timeout: 30_000 });
	await app.getByTestId("create-workspace").click();
	await expect(dialog).not.toBeShown();
	await expect(chatTabs(app).first()).toBeShown();
	const created = loadPersistedWorkspaces().find((workspace) => !before.has(workspace.id) && workspace.kind !== "default");
	if (!created) throw new Error("Workspace was not persisted after creation");
	return created;
}

export async function openWorkspaceMenu(row: NativeLocator): Promise<void> {
	await row.hover();
	await row.getByTestId("workspace-menu").click();
}

export async function enterDefaultWorkspace(app: NativeApp): Promise<void> {
	await app.getByTestId("welcome-action").filter({ hasText: "Work in project folder" }).click();
	await expect(defaultWorkspaceRow(app)).toHaveAttr("active", "true");
	await expect(app.getByTestId("center-tabs")).toBeShown();
}

export async function goProjectHome(app: NativeApp): Promise<void> {
	await app.getByTestId("project-item").filter({ hasText: "sample-project" }).getByTestId("project-name").click();
	await expect(app.getByTestId("welcome")).toBeShown();
}

export function visibleTerminal(app: NativeApp): NativeLocator {
	return app.getByTestId("terminal-instance").withAttr("visible", "true");
}

export function visibleTerminalScreen(app: NativeApp): NativeLocator {
	return visibleTerminal(app).getByTestId("terminal-screen");
}

export async function waitTerminalReady(app: NativeApp): Promise<void> {
	await expect(visibleTerminal(app)).toHaveAttr("ready", "true");
}

export async function runInTerminal(app: NativeApp, command: string): Promise<void> {
	const input = visibleTerminal(app).getByTestId("terminal-input");
	await input.fill(command);
	await input.press("Enter");
}

export async function revealFirstProjectWorkspaces(app: NativeApp): Promise<void> {
	const expand = app.getByTestId("project-expand").first();
	await expect(expand).toBeShown();
	if ((await expand.getAttribute("expanded")) !== "true") await expand.click();
}

export function renameInput(row: NativeLocator): NativeLocator {
	return row.getByTestId("workspace-rename-input");
}
