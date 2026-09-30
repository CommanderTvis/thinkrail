import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";
import { expect, test } from "./fixtures/native";

test("Skills renders existing controls as explicit switches without making rows interactive", async ({ app, wire }) => {
	const requests: Array<{ method?: string; params?: Record<string, unknown> }> = [];
	wire.tap({
		toHost: (frame) => {
			requests.push(frame as { method?: string; params?: Record<string, unknown> });
			return undefined;
		},
	});
	await openFixtureProject(app);
	await createWorkspaceViaDialog(app);
	await app.getByTestId("open-skills").click();
	await expect(app.getByTestId("skills-dialog")).toBeShown();

	const groupSwitch = app.getByTestId("group-toggle").first();
	await expect(groupSwitch).toHaveAttr("checked", "true");

	const skillSwitch = app.getByTestId("skill-toggle").withAttr("disabled", "false").first();
	const before = await skillSwitch.getAttribute("checked");
	const skillName = (await skillSwitch.getAttribute("skill")) ?? "";
	await expect(skillSwitch).toHaveAttr("hint", before === "true" ? "On — turn off" : "Off — turn on");

	const fixedRow = app.getByTestId("skill-row").withAttr("skill", skillName);
	await expect(fixedRow.getByTestId("skill-name").click()).rejects.toThrow("no onPress handler");
	await expect(fixedRow.getByTestId("skill-toggle")).toHaveAttr("checked", before ?? "false");

	await fixedRow.getByTestId("skill-toggle").click();
	await expect(fixedRow.getByTestId("skill-toggle")).toHaveAttr("checked", before === "true" ? "false" : "true");
	await expect
		.poll(
			() =>
				requests.findLast(
					(request) => request.method === "workspace.setSkillOverride" && request.params?.name === skillName,
				)?.params?.override,
		)
		.toBe(before === "true" ? "off" : "on");

	const group = app.getByTestId("skill-group").withAttr("group", (await fixedRow.getAttribute("group")) ?? "");
	const parentSwitch = group.getByTestId("group-toggle");
	await parentSwitch.click();
	await expect(parentSwitch).toHaveAttr("checked", "false");
	await expect(fixedRow.getByTestId("skill-toggle")).toHaveAttr("disabled", "true");
	await parentSwitch.click();
	await expect(parentSwitch).toHaveAttr("checked", "true");
});
