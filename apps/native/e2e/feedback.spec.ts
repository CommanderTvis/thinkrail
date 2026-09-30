import { WS_CHANNELS } from "@thinkrail/contracts";
import { waitConnected } from "./fixtures/app";
import { expect, type NativeApp, test } from "./fixtures/native";
import type { WireProxy } from "./fixtures/wire";

const BOOKING_URL = "https://calendar.app.google/5suMJdDEBFvYJ4zN9";
const INVITATION_COPY =
	"Join us for a user interview, tell us about your experience with ThinkRail, and receive 100 bonus credits in Central (JetBrains AI).";

function sendInvitation(wire: WireProxy): void {
	wire.sendToApp({ channel: WS_CHANNELS.feedbackInterview, data: {} });
}

function openedURLs(app: NativeApp): Promise<string[]> {
	return app.send("openedURLs", []);
}

test("feedback settings and the addressed interview prompt preserve the approved lifecycle", async ({ app, wire }) => {
	let welcomeFrame: string | undefined;
	let rejectNextResponse = false;
	const actions: string[] = [];
	wire.tap({
		toHost: (frame) => {
			const params = frame.params as { action?: string } | undefined;
			if (frame.method === "feedback.respond" && typeof frame.id === "string") {
				actions.push(params?.action ?? "");
				if (rejectNextResponse) {
					rejectNextResponse = false;
					wire.sendToApp({ id: frame.id, ok: false, error: "feedback response failed" });
					return "drop";
				}
			}
			return undefined;
		},
		toApp: (frame, raw) => {
			if (frame.channel === WS_CHANNELS.serverWelcome) welcomeFrame = raw;
			return undefined;
		},
	});

	await app.relaunch();
	await waitConnected(app);

	await app.getByTestId("open-settings").click();
	await app.getByTestId("settings-nav-feedback").click();
	const settings = app.getByTestId("settings-feedback");
	await expect(settings).toContainShownText(INVITATION_COPY);
	const settingsLink = settings.getByTestId("feedback-schedule-interview");
	await expect(settingsLink).toHaveAttr("href", BOOKING_URL);
	await settingsLink.click();
	await expect.poll(() => openedURLs(app)).toEqual([BOOKING_URL]);
	await expect.poll(() => actions).toEqual([]);
	await app.getByTestId("settings-dialog").press("Escape");
	await expect(app.getByTestId("settings-dialog")).not.toBeShown();

	sendInvitation(wire);
	const dialog = app.getByTestId("interview-prompt-dialog");
	await expect(dialog).toBeShown();
	await expect(dialog).toContainShownText("Help shape ThinkRail");
	await expect(dialog).toContainShownText(INVITATION_COPY);

	rejectNextResponse = true;
	await dialog.getByTestId("interview-postpone").click();
	await expect(dialog).toBeShown();
	await expect(
		app.getByTestId("toast").withAttr("variant", "error").filter({ hasText: "feedback response failed" }),
	).toBeShown();
	await dialog.getByTestId("interview-postpone").click();
	await expect(dialog).not.toBeShown();
	await expect.poll(() => actions).toEqual(["postpone", "postpone"]);

	sendInvitation(wire);
	await expect(dialog).toBeShown();
	await dialog.press("Escape");
	await expect(dialog).not.toBeShown();
	await expect.poll(() => actions.at(-1)).toBe("postpone");

	sendInvitation(wire);
	await expect(dialog).toBeShown();
	await dialog.getByTestId("interview-close").click();
	await expect(dialog).not.toBeShown();
	await expect.poll(() => actions.at(-1)).toBe("postpone");

	sendInvitation(wire);
	await expect(dialog).toBeShown();
	await app.getByTestId("dialog-overlay").click();
	await expect(dialog).not.toBeShown();
	await expect.poll(() => actions.at(-1)).toBe("postpone");

	sendInvitation(wire);
	await expect(dialog).toBeShown();
	await dialog.getByTestId("interview-never").click();
	await expect(dialog).not.toBeShown();
	await expect.poll(() => actions.at(-1)).toBe("never");

	sendInvitation(wire);
	await expect(dialog).toBeShown();
	if (!welcomeFrame) throw new Error("expected the host welcome frame");
	wire.sendToApp(welcomeFrame);
	await expect(dialog).not.toBeShown();

	sendInvitation(wire);
	await expect(dialog).toBeShown();
	const bookingLink = dialog.getByTestId("interview-book");
	await expect(bookingLink).toHaveAttr("href", BOOKING_URL);
	await bookingLink.click();
	await expect(dialog).not.toBeShown();
	await expect.poll(() => actions.at(-1)).toBe("book");
	await expect.poll(() => openedURLs(app)).toEqual([BOOKING_URL, BOOKING_URL]);
});
