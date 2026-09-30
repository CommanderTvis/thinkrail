import {
	createWorkspaceViaDialog,
	openFixtureProject,
	openWorkspaceMenu,
	revealFirstProjectWorkspaces,
	worktreeRows,
	renameInput,
	waitConnected,
} from "./fixtures/app";
import { expect, test } from "./fixtures/native";

test("workspace removal propagates — no zombie row in a second tab", async ({ app, openObserver }) => {
	await openFixtureProject(app);
	const created = await createWorkspaceViaDialog(app);
	await expect(worktreeRows(app)).toHaveElements(1);

	const page2 = await openObserver();
	await waitConnected(page2);
	await revealFirstProjectWorkspaces(page2);
	await expect(worktreeRows(page2)).toHaveElements(1);
	await worktreeRows(page2).first().click();
	await expect(worktreeRows(page2).first()).toHaveAttr("active", "true");

	await openWorkspaceMenu(worktreeRows(app).first());
	await app.getByTestId("workspace-remove").click();
	await app.getByTestId("confirm-remove").click();
	await expect(worktreeRows(app)).toHaveElements(0);

	await expect(worktreeRows(page2)).toHaveElements(0);
	await expect(page2.getByTestId("welcome")).toBeShown();
	await expect(page2.getByTestId("toast").filter({ hasText: created.name })).toBeShown();
});

test("workspace rename propagates live and rehydrates a tab that missed a later snapshot", async ({ app, openObserver }) => {
	await openFixtureProject(app);
	const created = await createWorkspaceViaDialog(app);
	const sourceRow = worktreeRows(app).first();

	const page2 = await openObserver();
	await waitConnected(page2);
	await revealFirstProjectWorkspaces(page2);
	const peerRow = worktreeRows(page2).first();
	await expect(peerRow).toBeShown();
	await openWorkspaceMenu(peerRow);
	await page2.getByTestId("workspace-rename").click();
	const peerInput = renameInput(peerRow);
	await expect(peerInput).toHaveInputValue(created.name);

	await openWorkspaceMenu(sourceRow);
	await app.getByTestId("workspace-rename").click();
	let input = renameInput(sourceRow);
	await input.fill("Shared Rename");
	await input.press("Enter");
	await expect(sourceRow.getByTestId("workspace-name")).toShowText("Shared Rename");
	await expect(peerInput).toHaveInputValue(created.name);
	await peerInput.press("Enter");
	for (const row of [sourceRow, peerRow]) {
		await expect(row.getByTestId("workspace-name")).toShowText("Shared Rename");
	}

	const releasePeerReconnect = page2.wire.holdReconnects();
	page2.wire.disconnect();
	await expect(page2.getByTestId("connection-status")).not.toHaveAttr("status", "connected");

	await openWorkspaceMenu(sourceRow);
	await app.getByTestId("workspace-rename").click();
	input = renameInput(sourceRow);
	await input.fill("Offline Rename");
	await input.press("Enter");
	await expect(sourceRow.getByTestId("workspace-name")).toShowText("Offline Rename");
	await expect(peerRow.getByTestId("workspace-name")).toShowText("Shared Rename");

	releasePeerReconnect();
	await expect(page2.getByTestId("connection-status")).toHaveAttr("status", "connected");
	await expect.poll(() => page2.wire.connections).toBeGreaterThan(1);

	for (const row of [sourceRow, peerRow]) {
		await expect(row.getByTestId("workspace-name")).toShowText("Offline Rename");
		await expect(row.getByTestId("workspace-branch")).toShowText(created.branch);
	}
});

test("removing the active workspace restores the previously selected workspace", async ({ app }) => {
	await openFixtureProject(app);
	const previous = await createWorkspaceViaDialog(app);
	const removed = await createWorkspaceViaDialog(app);
	const previousRow = worktreeRows(app).filter({ hasText: previous.name });
	const removedRow = worktreeRows(app).filter({ hasText: removed.name });

	await previousRow.click();
	await removedRow.click();
	await expect(removedRow).toHaveAttr("active", "true");

	await openWorkspaceMenu(removedRow);
	await app.getByTestId("workspace-remove").click();
	await app.getByTestId("confirm-remove").click();

	await expect(removedRow).toHaveElements(0);
	await expect(previousRow).toHaveAttr("active", "true");
	await expect(app.getByTestId("welcome")).toHaveElements(0);
});

test("workspace creation propagates to a second tab's rail", async ({ app, openObserver }) => {
	await openFixtureProject(app);

	const page2 = await openObserver();
	await waitConnected(page2);
	await revealFirstProjectWorkspaces(page2);
	await expect(worktreeRows(page2)).toHaveElements(0);

	await createWorkspaceViaDialog(app);
	await expect(worktreeRows(app)).toHaveElements(1);

	await expect(worktreeRows(page2)).toHaveElements(1);
});
