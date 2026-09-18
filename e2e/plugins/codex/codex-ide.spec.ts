import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, setPluginEnabled } from "../../fixtures/app";
import { E2E_CODEX_HOME_DIR } from "../../fixtures/paths";

test.skip(process.platform === "win32", "Codex's Windows pipe is machine-wide, not lane-isolated");

function ideContext(workspaceRoot: string): Promise<{
	resultType: string;
	result?: {
		ideContext: {
			activeFile: {
				path: string;
				activeSelectionContent: string;
				selection: { start: { line: number; character: number } };
			} | null;
			openTabs: { path: string }[];
		};
	};
}> {
	return new Promise((resolve, reject) => {
		const socket = connect(join(E2E_CODEX_HOME_DIR, "ipc", "ipc.sock"));
		const timer = setTimeout(() => {
			socket.destroy();
			reject(new Error("Codex IDE IPC timeout"));
		}, 4500);
		let buffer = Buffer.alloc(0);
		socket.once("error", reject);
		socket.once("close", () => clearTimeout(timer));
		socket.once("connect", () => {
			const body = Buffer.from(
				JSON.stringify({
					type: "request",
					requestId: randomUUID(),
					sourceClientId: "codex-tui",
					method: "ide-context",
					version: 0,
					params: { workspaceRoot },
				}),
			);
			const header = Buffer.alloc(4);
			header.writeUInt32LE(body.length);
			socket.write(Buffer.concat([header, body]));
		});
		socket.on("data", (chunk) => {
			buffer = Buffer.concat([buffer, chunk]);
			if (buffer.length < 4 || buffer.length < 4 + buffer.readUInt32LE()) return;
			resolve(JSON.parse(buffer.subarray(4, 4 + buffer.readUInt32LE()).toString()));
			socket.destroy();
		});
	});
}

test("Codex IDE context follows real editor selections, closure, reload, and plugin lifetime", async ({
	page,
	context,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	await setPluginEnabled(page, "codex", true);
	try {
		await page.getByTestId("tab-files").click();
		await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).dblclick();
		const editor = page.getByTestId("editor-pane");
		await expect(editor).toContainText("plain-text-fixture");
		await editor.locator(".view-line").first().click({ clickCount: 3 });
		await expect
			.poll(
				async () =>
					(await ideContext(workspace.worktreePath)).result?.ideContext.activeFile
						?.activeSelectionContent,
			)
			.toContain("plain-text-fixture");
		expect((await ideContext(workspace.worktreePath)).result?.ideContext).toMatchObject({
			openTabs: [{ path: "notes.txt" }],
			activeFile: {
				path: "notes.txt",
				selection: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
			},
		});
		expect((await ideContext(`${workspace.worktreePath}-other`)).resultType).toBe("error");
		mkdirSync(join(workspace.worktreePath, "nested"));
		expect(
			(await ideContext(join(workspace.worktreePath, "nested"))).result?.ideContext.activeFile
				?.path,
		).toBe(join("..", "notes.txt"));
		const other = await context.newPage();
		try {
			await page.evaluate(() => {
				document.hasFocus = () => false;
			});
			await other.goto(page.url());
			await expect(other.getByTestId("connection-status")).toHaveAttribute(
				"data-status",
				"connected",
			);
			await other.getByTestId("tab-files").click();
			await other.getByTestId("file-node").filter({ hasText: "LONG_LINE.txt" }).dblclick();
			await other.bringToFront();
			await expect
				.poll(async () => await ideContext(workspace.worktreePath))
				.toMatchObject({
					resultType: "success",
					result: { ideContext: { activeFile: { path: "LONG_LINE.txt" } } },
				});
		} finally {
			await other.close();
			await page.evaluate(() => {
				Reflect.deleteProperty(document, "hasFocus");
			});
		}
		await page.bringToFront();
		await expect
			.poll(
				async () => (await ideContext(workspace.worktreePath)).result?.ideContext.activeFile?.path,
			)
			.toBe("notes.txt");
		await page.reload();
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await expect
			.poll(async () => (await ideContext(workspace.worktreePath)).result?.ideContext.openTabs)
			.toEqual([{ path: "notes.txt", label: "notes.txt" }]);
		await page
			.getByTestId("editor-tab")
			.filter({ hasText: "notes.txt" })
			.getByTestId("editor-tab-close")
			.click();
		await expect
			.poll(async () => (await ideContext(workspace.worktreePath)).result?.ideContext)
			.toEqual({ activeFile: null, openTabs: [] });
		await setPluginEnabled(page, "codex", false);
		await expect
			.poll(async () => {
				try {
					return (await ideContext(workspace.worktreePath)).resultType;
				} catch {
					return "unavailable";
				}
			})
			.not.toBe("success");
		await setPluginEnabled(page, "codex", true);
		await expect
			.poll(async () => {
				try {
					return (await ideContext(workspace.worktreePath)).resultType;
				} catch {
					return "unavailable";
				}
			})
			.toBe("success");
	} finally {
		await setPluginEnabled(page, "codex", false);
	}
});
