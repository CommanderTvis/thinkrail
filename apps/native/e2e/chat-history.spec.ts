import { existsSync, mkdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TodoStore } from "pi-todos/core";
import { E2E_FIXTURE_REPO } from "../../../e2e/fixtures/paths";
import { seedWorkspaceSession } from "../../../e2e/fixtures/sessions";
import {
	chatTabs,
	defaultWorkspaceRow,
	enterDefaultWorkspace,
	openFixtureProject,
	revealFirstProjectWorkspaces,
	waitConnected,
} from "./fixtures/app";
import { expect, test } from "./fixtures/native";

const BASE_TS = 1_700_200_000_000;

const repoCwd = () => realpathSync(E2E_FIXTURE_REPO);

function setMtime(path: string, ms: number): void {
	utimesSync(path, new Date(ms), new Date(ms));
}

function seedOpenTodo(sessionId: string, title: string): void {
	const contextDir = join(repoCwd(), ".thinkrail", "context");
	mkdirSync(contextDir, { recursive: true });
	writeFileSync(join(contextDir, ".gitignore"), "*\n");
	new TodoStore(repoCwd(), sessionId).add({ title });
}

test.afterEach(() => {
	rmSync(join(E2E_FIXTURE_REPO, ".thinkrail"), { recursive: true, force: true });
});

test("a disk chat with unfinished work auto-opens; a finished one stays in local history", async ({ app }) => {
	await openFixtureProject(app);

	const todoChat = seedWorkspaceSession(repoCwd(), {
		name: "the migration chat",
		messages: [
			{ role: "user", text: "start the migration", timestamp: BASE_TS },
			...Array.from({ length: 30 }, (_, i) => ({
				role: "assistant" as const,
				text: `migration step ${i + 1} done`,
				timestamp: BASE_TS + 1_000 + i,
			})),
			{
				role: "assistant",
				text: "stopped before the final verification pass",
				timestamp: BASE_TS + 60_000,
			},
		],
	});
	setMtime(todoChat.path, BASE_TS);
	seedOpenTodo(todoChat.id, "run the final verification pass");

	const doneChat = seedWorkspaceSession(repoCwd(), {
		name: "release notes chat",
		messages: [{ role: "user", text: "ship the release notes", timestamp: BASE_TS + 100_000 }],
	});
	setMtime(doneChat.path, BASE_TS + 100_000);

	await enterDefaultWorkspace(app);

	await expect(chatTabs(app)).toHaveElements(1);
	await expect(app.getByText("stopped before the final verification pass")).toBeShown();
	await app.getByTestId("chat-history").first().click();
	await expect(app.getByTestId("closed-chat-item")).toHaveElements(1);
	await expect(
		app.getByTestId("closed-chat-item").filter({ hasText: "release notes chat" }),
	).toBeShown();
});

test("the native name command renames a chat durably without sending an agent turn", async ({ app }) => {
	await openFixtureProject(app);
	seedWorkspaceSession(repoCwd(), {
		name: "before command rename",
		messages: [{ role: "user", text: "existing prompt", timestamp: BASE_TS }],
	});

	await enterDefaultWorkspace(app);
	const chatTab = chatTabs(app);
	await expect(chatTab).toContainShownText("before command rename");
	const input = app.getByTestId("chat-input");
	await input.fill("/name Command renamed chat");
	await input.press("Enter");
	await expect(chatTab).toContainShownText("Command renamed chat");
	await expect(input).toHaveInputValue("");
	await expect(app.getByText("/name Command renamed chat", { exact: true })).toHaveElements(0);

	await app.relaunch({ keepPreferences: true });
	await waitConnected(app);
	await expect(chatTabs(app)).toContainShownText("Command renamed chat");
});

test("open and closed chat rename controls edit their labels inline", async ({ app }) => {
	await openFixtureProject(app);
	const closed = seedWorkspaceSession(repoCwd(), {
		name: "closed before rename",
		messages: [{ role: "user", text: "older prompt", timestamp: BASE_TS }],
	});
	setMtime(closed.path, BASE_TS);
	const open = seedWorkspaceSession(repoCwd(), {
		name: "open before rename",
		messages: [{ role: "user", text: "newer prompt", timestamp: BASE_TS + 10_000 }],
	});
	setMtime(open.path, BASE_TS + 10_000);

	await enterDefaultWorkspace(app);
	const chatTab = chatTabs(app);
	await expect(chatTab).toContainShownText("open before rename");
	const startTabRename = async () => {
		await chatTab.click({ button: "right" });
		await app.getByTestId("tab-menu-rename").click();
		const input = chatTab.getByTestId("chat-tab-name-input");
		await expect(input).toBeShown();
		return input;
	};
	let tabNameInput = await startTabRename();
	await expect(tabNameInput).toHaveInputValue("open before rename");
	await tabNameInput.fill("x".repeat(81));
	await tabNameInput.press("Enter");
	await expect(chatTab).toContainShownText("open before rename");

	tabNameInput = await startTabRename();
	await tabNameInput.fill("discarded tab rename");
	await tabNameInput.press("Escape");
	await expect(chatTab).toContainShownText("open before rename");

	tabNameInput = await startTabRename();
	await tabNameInput.fill("open after rename");
	await tabNameInput.press("Enter");
	await expect(tabNameInput).toHaveElements(0);
	await expect(chatTab).toContainShownText("open after rename");

	await app.getByTestId("chat-history").first().click();
	const closedRow = app.getByTestId("closed-chat-row").withAttr("session-id", closed.id);
	const startHistoryRename = async () => {
		await closedRow.getByTestId("closed-chat-rename").click();
		const input = closedRow.getByTestId("closed-chat-name-input");
		await expect(input).toBeShown();
		return input;
	};
	let historyNameInput = await startHistoryRename();
	await expect(historyNameInput).toHaveInputValue("closed before rename");
	await historyNameInput.fill("x".repeat(81));
	await historyNameInput.press("Enter");
	await expect(closedRow).toContainShownText("closed before rename");

	historyNameInput = await startHistoryRename();
	await historyNameInput.fill("discarded history rename");
	await historyNameInput.press("Escape");
	await expect(closedRow).toContainShownText("closed before rename");

	historyNameInput = await startHistoryRename();
	await historyNameInput.fill("closed after rename");
	await historyNameInput.press("Enter");
	await expect(historyNameInput).toHaveElements(0);
	await expect(chatTab).toHaveElements(1);
	await expect(closedRow).toContainShownText("closed after rename");
});

test("long chat history remains named and scrollable", async ({ app }) => {
	await openFixtureProject(app);
	for (let index = 0; index < 30; index += 1) {
		const session = seedWorkspaceSession(repoCwd(), {
			name: `history item ${String(index).padStart(2, "0")}`,
			messages: [{ role: "user", text: `prompt ${index}`, timestamp: BASE_TS + index * 1_000 }],
		});
		setMtime(session.path, BASE_TS + index * 1_000);
	}

	await enterDefaultWorkspace(app);
	await app.getByTestId("chat-history").first().click();
	const popover = app.getByTestId("chat-history-popover");
	await expect(popover).toBeShown();
	await expect(app.getByTestId("closed-chat-item")).toHaveElements(29);
	const oldest = app.getByTestId("closed-chat-item").filter({ hasText: "history item 00" });
	await expect(oldest).toBeShown();
});

test("a closed chat can be moved to trash from history", async ({ app }) => {
	await openFixtureProject(app);

	const doomed = seedWorkspaceSession(repoCwd(), {
		name: "trash this chat",
		messages: [{ role: "user", text: "remove this transcript", timestamp: BASE_TS }],
	});
	setMtime(doomed.path, BASE_TS);
	const searchDoomed = seedWorkspaceSession(repoCwd(), {
		name: "search trash chat",
		messages: [{ role: "user", text: "delete this from search", timestamp: BASE_TS + 10_000 }],
	});
	setMtime(searchDoomed.path, BASE_TS + 10_000);
	const kept = seedWorkspaceSession(repoCwd(), {
		name: "keep this chat",
		messages: [{ role: "user", text: "keep this transcript", timestamp: BASE_TS + 50_000 }],
	});
	setMtime(kept.path, BASE_TS + 50_000);

	await enterDefaultWorkspace(app);
	await expect(app.getByText("keep this transcript")).toBeShown();
	await app.getByTestId("chat-history").first().click();
	const row = app.getByTestId("closed-chat-row").filter({ hasText: "trash this chat" });
	await row.getByTestId("closed-chat-delete").click();

	await expect.poll(() => existsSync(doomed.path)).toBe(false);
	await app.getByTestId("chat-history").first().click();
	await expect(
		app.getByTestId("closed-chat-row").filter({ hasText: "trash this chat" }),
	).toHaveElements(0);
	await app.getByTestId("chat-history-popover").press("Escape");
	await expect(app.getByText("remove this transcript")).toHaveElements(0);

	await app.getByTestId("chat-input").press("Control+r");
	await app.getByTestId("history-query").fill("delete this from search");
	const searchRow = app.getByTestId("history-item").withAttr("kind", "prompt").filter({ hasText: "delete this from search" });
	await searchRow.getByTestId("history-delete-chat").click();
	await expect(app.getByTestId("history-overlay")).toHaveElements(0);
	await expect.poll(() => existsSync(searchDoomed.path)).toBe(false);
});

test("trashing a chat converges to a second client", async ({ app, openObserver }) => {
	await openFixtureProject(app);

	const doomed = seedWorkspaceSession(repoCwd(), {
		name: "shared doomed chat",
		messages: [{ role: "user", text: "shared doomed transcript", timestamp: BASE_TS }],
	});
	setMtime(doomed.path, BASE_TS);

	await enterDefaultWorkspace(app);
	await expect(app.getByText("shared doomed transcript")).toBeShown();

	const page2 = await openObserver();
	await waitConnected(page2);
	await revealFirstProjectWorkspaces(page2);
	await defaultWorkspaceRow(page2).click();
	await expect(page2.getByText("shared doomed transcript")).toBeShown();

	const chatTab = chatTabs(app);
	await chatTab.getByTestId("editor-tab-close").click();
	await app.getByTestId("chat-history").first().click();
	const row = app.getByTestId("closed-chat-row").filter({ hasText: "shared doomed chat" });
	await row.getByTestId("closed-chat-delete").click();

	await expect.poll(() => existsSync(doomed.path)).toBe(false);
	await expect(chatTabs(page2)).toHaveElements(0);
	await expect(page2.getByTestId("workspace-ready").first()).toBeShown();
});

test("a client that misses chat deletion while offline reconciles it after reconnect", async ({ app, openObserver }) => {
	await openFixtureProject(app);

	const doomed = seedWorkspaceSession(repoCwd(), {
		name: "offline doomed chat",
		messages: [{ role: "user", text: "offline doomed transcript", timestamp: BASE_TS }],
	});
	setMtime(doomed.path, BASE_TS);

	await enterDefaultWorkspace(app);
	await expect(app.getByText("offline doomed transcript")).toBeShown();

	const page2 = await openObserver();
	await waitConnected(page2);
	await revealFirstProjectWorkspaces(page2);
	await defaultWorkspaceRow(page2).click();
	await expect(page2.getByText("offline doomed transcript")).toBeShown();

	const releaseReconnect = page2.wire.holdReconnects();
	page2.wire.disconnect();
	await expect(page2.getByTestId("connection-status")).toHaveAttr("status", "disconnected");

	const chatTab = chatTabs(app);
	await chatTab.getByTestId("editor-tab-close").click();
	await app.getByTestId("chat-history").first().click();
	await app
		.getByTestId("closed-chat-row")
		.filter({ hasText: "offline doomed chat" })
		.getByTestId("closed-chat-delete")
		.click();
	await expect.poll(() => existsSync(doomed.path)).toBe(false);

	releaseReconnect();
	await expect(page2.getByTestId("connection-status")).toHaveAttr("status", "connected");
	await expect(chatTabs(page2)).toHaveElements(0);
	await expect(page2.getByTestId("workspace-ready").first()).toBeShown();
});

test("with no TODOs, the single newest disk chat opens as a fallback; older ones stay in history", async ({ app }) => {
	await openFixtureProject(app);

	const older = seedWorkspaceSession(repoCwd(), {
		name: "older fallback chat",
		messages: [{ role: "user", text: "the older fallback chat", timestamp: BASE_TS }],
	});
	setMtime(older.path, BASE_TS);
	const newest = seedWorkspaceSession(repoCwd(), {
		name: "newest fallback chat",
		messages: [{ role: "user", text: "the newest fallback chat", timestamp: BASE_TS + 50_000 }],
	});
	setMtime(newest.path, BASE_TS + 50_000);

	await enterDefaultWorkspace(app);

	await expect(chatTabs(app)).toHaveElements(1);
	await expect(app.getByText("the newest fallback chat")).toBeShown();
	await app.getByTestId("chat-history").first().click();
	await expect(app.getByTestId("closed-chat-item")).toHaveElements(1);
	await expect(
		app.getByTestId("closed-chat-item").filter({ hasText: "older fallback chat" }),
	).toBeShown();
});
