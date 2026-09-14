import { describe, expect, test } from "bun:test";
import { CLAUDE_SETTINGS_DOC_KEYS, settingsDocsUrl } from "./settingsDocs";

const REFERENCE = "https://code.claude.com/docs/en/settings-reference";

describe("settingsDocsUrl", () => {
	test("links a documented key to its entry", () => {
		expect(settingsDocsUrl("permissions.defaultMode")).toBe(`${REFERENCE}#permissionsdefaultmode`);
	});

	test("falls back to the nearest documented ancestor", () => {
		// A key the reference will never list one by one is still explained by the section above it.
		expect(settingsDocsUrl("permissions.defaultMode.somethingNested")).toBe(
			`${REFERENCE}#permissionsdefaultmode`,
		);
	});

	test("offers no link for a key the reference does not list", () => {
		// Absent means "newer than this list", so the pane shows the key and claims nothing further.
		expect(settingsDocsUrl("someFutureKeyNobodyHasDocumentedYet")).toBeUndefined();
	});

	test("every listed key resolves to a link", () => {
		const unlinked = CLAUDE_SETTINGS_DOC_KEYS.filter((key) => settingsDocsUrl(key) === undefined);
		expect(unlinked).toEqual([]);
	});
});
