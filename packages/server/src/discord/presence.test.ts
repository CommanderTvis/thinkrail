import { describe, expect, it } from "bun:test";
import { DEFAULT_DISCORD_SETTINGS, type DiscordPresence } from "@thinkrail/contracts";
import { decidePresence, statusFor } from "./presence";

const STARTED = 1_700_000_000_000;
const READY = {
	...DEFAULT_DISCORD_SETTINGS,
	enabled: true,
	applicationId: "1234567890123456789",
};
const AT_WORK: DiscordPresence = {
	projectId: "p1",
	projectName: "thinkrail",
	filePath: "src/host/server.ts",
};

describe("what reaches Discord", () => {
	it("publishes the project and the focused file", () => {
		const decision = decidePresence(AT_WORK, READY, STARTED);
		expect(decision).toEqual({
			kind: "publish",
			activity: { details: "Editing server.ts", state: "thinkrail", startedAt: STARTED },
		});
	});

	it("names the file, never the path that leads to it", () => {
		const decision = decidePresence(
			{ ...AT_WORK, filePath: "clients/acme/contracts/pricing.ts" },
			READY,
			STARTED,
		);
		if (decision.kind !== "publish") throw new Error("expected a publish");
		expect(decision.activity.details).toBe("Editing pricing.ts");
		expect(JSON.stringify(decision.activity)).not.toContain("acme");
	});

	it("keeps a blocked project off Discord entirely, not merely anonymous", () => {
		const decision = decidePresence(AT_WORK, { ...READY, blockedProjectIds: ["p1"] }, STARTED);
		expect(decision.kind).toBe("clear");
		expect(JSON.stringify(decision)).not.toContain("server.ts");
	});

	it("drops the file name but keeps the project when file sharing is off", () => {
		const decision = decidePresence(AT_WORK, { ...READY, shareFileName: false }, STARTED);
		if (decision.kind !== "publish") throw new Error("expected a publish");
		expect(decision.activity.details).toBeNull();
		expect(decision.activity.state).toBe("thinkrail");
	});

	it("says nothing rather than claiming no file is open when the name is merely withheld", () => {
		const withheld = decidePresence(AT_WORK, { ...READY, shareFileName: false }, STARTED);
		const noFile = decidePresence({ ...AT_WORK, filePath: null }, READY, STARTED);
		if (withheld.kind !== "publish" || noFile.kind !== "publish")
			throw new Error("expected publishes");
		expect(withheld.activity.details).toBeNull();
		expect(noFile.activity.details).toBeNull();
		expect(JSON.stringify(withheld.activity)).not.toContain("server.ts");
	});

	it("stays silent while off, so no socket is ever opened", () => {
		expect(decidePresence(AT_WORK, { ...READY, enabled: false }, STARTED)).toMatchObject({
			kind: "silent",
			state: "off",
		});
	});

	it("stays silent until an application id is configured", () => {
		expect(decidePresence(AT_WORK, { ...READY, applicationId: "" }, STARTED)).toMatchObject({
			kind: "silent",
			state: "unconfigured",
		});
		expect(
			decidePresence(AT_WORK, { ...READY, applicationId: "not-a-snowflake" }, STARTED),
		).toMatchObject({ kind: "silent", state: "unconfigured" });
	});

	it("holds the timer across a file change so the elapsed time tracks the project", () => {
		const first = decidePresence(AT_WORK, READY, STARTED);
		const second = decidePresence({ ...AT_WORK, filePath: "other.ts" }, READY, STARTED);
		if (first.kind !== "publish" || second.kind !== "publish")
			throw new Error("expected publishes");
		expect(second.activity.startedAt).toBe(first.activity.startedAt);
	});
});

describe("what the settings pane is told", () => {
	it("reports the exact pair Discord received", () => {
		const status = statusFor(decidePresence(AT_WORK, READY, STARTED), true, null);
		expect(status).toEqual({
			state: "connected",
			published: { details: "Editing server.ts", state: "thinkrail" },
			detail: null,
		});
	});

	it("prefers a connection failure over claiming to be connected", () => {
		const status = statusFor(
			decidePresence(AT_WORK, READY, STARTED),
			false,
			"Discord is not running on this machine.",
		);
		expect(status.state).toBe("unavailable");
		expect(status.published).toBeNull();
	});

	it("says why nothing is published when a project is blocked", () => {
		const status = statusFor(
			decidePresence(AT_WORK, { ...READY, blockedProjectIds: ["p1"] }, STARTED),
			true,
			null,
		);
		expect(status.state).toBe("connected");
		expect(status.published).toBeNull();
		expect(status.detail).toBe("thinkrail is blocked from Discord.");
	});

	it("never reports a failure while the integration is off", () => {
		const status = statusFor(
			decidePresence(AT_WORK, { ...READY, enabled: false }, STARTED),
			false,
			"Discord is not running on this machine.",
		);
		expect(status.state).toBe("off");
	});
});
