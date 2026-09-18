import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	runInTerminal,
	visibleTerminalScreen,
	waitTerminalReady,
} from "./fixtures/app";

test("terminal plain, wrapped, and OSC 8 links open their destinations", async ({
	page,
	context,
}) => {
	await context.route("https://example.com/**", (route) =>
		route.fulfill({ contentType: "text/html", body: "Terminal link destination" }),
	);
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	const plain = "https://example.com/plain";
	const wrapped = `https://example.com/wrapped/${"segment/".repeat(30)}`;
	const explicit = "https://example.com/osc8";
	const output = `\u001b[2J\u001b[H(${plain})\r\n${wrapped}\r\n\u001b]8;;${explicit}\u0007Open PR #514\u001b]8;;\u0007\r\n`;
	writeFileSync(join(workspace.worktreePath, "links.txt"), output);
	await runInTerminal(page, "cat links.txt");
	const screen = visibleTerminalScreen(page);
	await expect(screen).toContainText("Open PR #514");
	for (const modifiers of [[], ["Meta"], ["Control"]] as const) {
		for (const [label, url] of [
			[/https:\/\/example.com\/plain/, plain],
			[/https:\/\/example.com\/wrapped\//, wrapped],
			[/Open\sPR\s#514/, explicit],
		] as const) {
			const link = screen.locator(":scope > div").filter({ hasText: label }).first();
			await link.hover({ force: true, position: { x: 20, y: 5 } });
			const popupPromise = page.waitForEvent("popup");
			await link.click({ force: true, modifiers: [...modifiers], position: { x: 20, y: 5 } });
			const popup = await popupPromise;
			await expect(popup).toHaveURL(url);
			expect(await popup.evaluate(() => window.opener)).toBeNull();
			await popup.close();
		}
	}
});
