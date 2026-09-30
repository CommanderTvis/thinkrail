import { realpathSync, rmSync } from "node:fs";
import { E2E_FIXTURE_REPO } from "../../../e2e/fixtures/paths";
import { seedWorkspaceSession } from "../../../e2e/fixtures/sessions";
import { defaultWorkspaceRow, enterDefaultWorkspace, openFixtureProject, openPersistedChat, waitConnected } from "./fixtures/app";
import { expect, type NativeApp, type NativeLocator, test } from "./fixtures/native";

const BASE_TS = 1_704_000_000_000;

async function reconnectWithSeed(app: NativeApp): Promise<void> {
	await app.relaunch();
	await waitConnected(app);
	await expect(app.getByTestId("project-item").first()).toBeShown();
}

async function expectAttentionDot(row: NativeLocator): Promise<void> {
	await expect(row).toHaveAttr("attention", "true");
	await expect(row.getByTestId("attention-dot")).toBeShown();
	await expect(row.getByLabel("Needs attention")).toBeShown();
}

async function collapse(project: NativeLocator): Promise<void> {
	const expand = project.getByTestId("project-expand");
	if ((await expand.getAttribute("expanded")) === "true") await expand.click();
}

test("an unresolved persisted question is level-triggered in project and workspace state", async ({ app }) => {
	await openFixtureProject(app);
	const args = {
		questions: [
			{
				question: "Which rollout?",
				header: "Rollout",
				options: [
					{ label: "Canary", description: "Start small" },
					{ label: "All", description: "Ship everywhere" },
				],
			},
		],
	};
	const session = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "needs input state",
		messages: [
			{ role: "user", text: "Ask for rollout input.", timestamp: BASE_TS },
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "state-question", name: "ask_user_question", arguments: args }],
				stopReason: "toolUse",
				timestamp: BASE_TS + 1,
			},
		],
	});
	try {
		await reconnectWithSeed(app);
		const project = app.getByTestId("project-item").first();
		const expand = project.getByTestId("project-expand");
		const workspace = defaultWorkspaceRow(app);
		await expectAttentionDot(workspace);
		await expect(expand).toHaveAttr("expanded", "true");
		await expand.click();
		await expectAttentionDot(project);
		await expand.click();
		await expectAttentionDot(workspace);
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("entering a workspace clears its visible unread result without a chat click", async ({ app }) => {
	await openFixtureProject(app);
	const session = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "workspace entry receipt",
		messages: [
			{ role: "user", text: "Finish before workspace entry.", timestamp: BASE_TS + 5 },
			{ role: "assistant", text: "Visible workspace result.", timestamp: BASE_TS + 6 },
		],
	});
	try {
		await reconnectWithSeed(app);
		const workspace = defaultWorkspaceRow(app);
		await expectAttentionDot(workspace);

		await enterDefaultWorkspace(app);
		await expect(app.getByText("Visible workspace result.", { exact: true })).toBeShown();
		await expect(workspace).not.toHaveAttr("attention", "true");
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("an unread finished result clears only after direct chat activation renders it", async ({ app, openObserver }) => {
	await openFixtureProject(app);
	const session = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "finished state receipt",
		messages: [
			{ role: "user", text: "Finish this run.", timestamp: BASE_TS + 10 },
			{ role: "assistant", text: "Finished result.", timestamp: BASE_TS + 11 },
		],
	});
	const quietSibling = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), { name: "quiet sibling", messages: [] });
	try {
		await reconnectWithSeed(app);
		const project = app.getByTestId("project-item").first();
		const workspace = defaultWorkspaceRow(app);
		await expectAttentionDot(workspace);
		await expect(project.getByTestId("project-expand")).toHaveAttr("expanded", "true");
		await project.getByTestId("project-expand").click();
		await expectAttentionDot(project);
		const peer = await openObserver();
		await waitConnected(peer);
		const peerProject = peer.getByTestId("project-item").first();
		await collapse(peerProject);
		await expectAttentionDot(peerProject);

		await project.getByTestId("project-expand").click();
		await enterDefaultWorkspace(app);
		await openPersistedChat(app, "finished state receipt");
		await expect(app.getByText("Finished result.", { exact: true })).toBeShown();
		await expect(workspace).not.toHaveAttr("attention", "true");
		await collapse(project);
		await expect(project).not.toHaveAttr("attention", "true");
		await expect(peerProject).not.toHaveAttr("attention", "true");
	} finally {
		rmSync(session.path, { force: true });
		rmSync(quietSibling.path, { force: true });
	}
});
