import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	runInTerminal,
	visibleTerminal,
	visibleTerminalScreen,
	waitTerminalReady,
} from "./fixtures/app";

const PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";

async function paste(page: Page, mime = "image/png", count = 1) {
	await visibleTerminal(page)
		.locator(".xterm-helper-textarea")
		.evaluate(
			(el, { png, mime, count }) => {
				const data = new DataTransfer();
				for (let i = 0; i < count; i++)
					data.items.add(
						new File([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], "clipboard.png", {
							type: mime,
						}),
					);
				data.setData("text/plain", "DO_NOT_INSERT_IMAGE_FALLBACK");
				el.dispatchEvent(
					new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
				);
			},
			{ png: PNG, mime, count },
		);
}

test("clipboard images reach a real PTY as separate bracketed host paths without submitting", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	const probe = `const fs=require("fs");process.stdin.setRawMode(true);process.stdout.write("\\x1b[?2004h"+"IMAGE_"+"READY\\n");let text="";process.stdin.on("data",b=>{text+=b.toString();if((text.match(/\\x1b\\[201~/g)||[]).length===2){const paths=[...text.matchAll(/\\x1b\\[200~(.*?)\\x1b\\[201~/g)].map(m=>m[1].trim().replace(/^'|'$/g,""));process.stdout.write("\\x1b[?2004l\\r\\n"+JSON.stringify({images:paths.map(p=>fs.readFileSync(p).toString("base64")),submitted:text.includes("\\r")})+"\\r\\n");process.stdin.setRawMode(false);process.exit(0)}});`;
	writeFileSync(join(workspace.worktreePath, "image-probe.cjs"), probe);
	await runInTerminal(page, "bun image-probe.cjs");
	await expect(visibleTerminalScreen(page)).toContainText("IMAGE_READY");
	await paste(page, "image/png", 2);
	await expect(visibleTerminalScreen(page)).toContainText(`"images":["${PNG}","${PNG}"]`);
	await expect(visibleTerminalScreen(page)).toContainText('"submitted":false');
	await expect(visibleTerminalScreen(page)).not.toContainText("DO_NOT_INSERT_IMAGE_FALLBACK");
});

test("unsupported images explain the failure and ordinary text paste still works", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	await paste(page, "image/heic");
	await expect(page.getByTestId("terminal-paste-error")).toContainText(
		"Use PNG, JPEG, GIF, or WebP",
	);
	await visibleTerminal(page)
		.locator(".xterm-helper-textarea")
		.evaluate((el) => {
			const data = new DataTransfer();
			data.setData("text/plain", "echo TEXT_PASTE_OK");
			el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
		});
	await page.keyboard.press("Enter");
	await expect(visibleTerminalScreen(page)).toContainText("TEXT_PASTE_OK");
	await expect(visibleTerminalScreen(page)).not.toContainText("DO_NOT_INSERT_IMAGE_FALLBACK");
});

for (const outcome of ["success", "failure"] as const) {
	test(`a cancelled upload's ${outcome} cannot block or affect a reclaimed terminal`, async ({
		page,
	}) => {
		let release: (() => void) | undefined;
		let detach: ((workspaceId: string, tabKey: string) => void) | undefined;
		const writes: string[] = [];
		await page.routeWebSocket(/\/ws/, (ws) => {
			const server = ws.connectToServer();
			detach = (workspaceId, tabKey) =>
				ws.send(JSON.stringify({ channel: "terminal.detached", data: { workspaceId, tabKey } }));
			ws.onMessage((message) => {
				const frame = JSON.parse(message.toString()) as {
					id?: string;
					method?: string;
					params?: { data?: string };
				};
				if (frame.method === "terminal.saveImage") {
					release = () =>
						ws.send(
							JSON.stringify(
								outcome === "success"
									? { id: frame.id, ok: true, result: { path: "/tmp/stale-image.png" } }
									: { id: frame.id, ok: false, error: "Stale upload failed" },
							),
						);
					return;
				}
				if (frame.method === "terminal.write") writes.push(frame.params?.data ?? "");
				server.send(message);
			});
			server.onMessage((message) => ws.send(message));
		});
		await openFixtureProject(page);
		const workspace = await createWorkspaceViaDialog(page);
		await waitTerminalReady(page);
		const terminal = visibleTerminal(page);
		const tabKey = await terminal.getAttribute("data-tab-key");
		if (!tabKey) throw new Error("Missing terminal tab key");
		await paste(page);
		await expect.poll(() => !!release).toBe(true);
		detach?.(workspace.id, tabKey);
		await terminal.getByTestId("terminal-take-back").click();
		await waitTerminalReady(page);
		writes.length = 0;
		await runInTerminal(page, "echo RECLAIMED");
		await expect(visibleTerminalScreen(page)).toContainText("RECLAIMED");
		release?.();
		await runInTerminal(page, "echo STILL_READY");
		await expect(visibleTerminalScreen(page)).toContainText("STILL_READY");
		expect(writes.join("")).not.toContain("stale-image");
		await expect(page.getByTestId("terminal-paste-error")).toHaveCount(0);
	});
}

for (const outcome of ["success", "failure"] as const) {
	test(`input waits behind image upload through ${outcome}`, async ({ page }) => {
		let completeUpload: (() => void) | undefined;
		const writes: string[] = [];
		await page.routeWebSocket(/\/ws/, (ws) => {
			const server = ws.connectToServer();
			ws.onMessage((message) => {
				const frame = JSON.parse(message.toString()) as {
					id?: string;
					method?: string;
					params?: { data?: string };
				};
				if (frame.method === "terminal.saveImage") {
					completeUpload = () =>
						ws.send(
							JSON.stringify(
								outcome === "success"
									? { id: frame.id, ok: true, result: { path: "/tmp/queued-image.png" } }
									: { id: frame.id, ok: false, error: "Disk full" },
							),
						);
					return;
				}
				if (frame.method === "terminal.write") writes.push(frame.params?.data ?? "");
				server.send(message);
			});
			server.onMessage((message) => ws.send(message));
		});
		await openFixtureProject(page);
		await createWorkspaceViaDialog(page);
		await waitTerminalReady(page);
		await visibleTerminal(page).locator(".xterm-helper-textarea").focus();
		await paste(page);
		await expect.poll(() => !!completeUpload).toBe(true);
		writes.length = 0;
		await page.keyboard.type("echo MUST_NOT_RUN");
		await page.keyboard.press("Enter");
		expect(writes).toEqual([]);
		completeUpload?.();
		if (outcome === "failure") {
			await expect(page.getByTestId("terminal-paste-error")).toContainText("Disk full");
			expect(writes).toEqual([]);
		} else {
			await expect.poll(() => writes.join("")).toContain("echo MUST_NOT_RUN\r");
			expect(writes[0]).toContain("/tmp/queued-image.png");
			await expect(page.getByTestId("terminal-paste-error")).toHaveCount(0);
		}
	});
}
