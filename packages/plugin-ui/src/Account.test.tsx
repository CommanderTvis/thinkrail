import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountUsageWindow, accountReadingLabel } from "./Account";

function usage(percent: number, resetsAt: number | null) {
	return renderToStaticMarkup(
		<AccountUsageWindow
			id="weekly"
			label="Weekly"
			percent={percent}
			resetsAt={resetsAt}
			testIdPrefix="agent"
		/>,
	);
}

test("usage text and accessible meter agree, including out-of-range readings", () => {
	for (const [input, expected] of [
		[25, 25],
		[-10, 0],
		[110, 100],
	] as const) {
		const html = usage(input, null);
		expect(html).toContain(`${expected}% used`);
		expect(html).toContain(`value="${expected}" max="100"`);
		expect(html).toContain('aria-label="Weekly usage"');
	}
});

test("expired resets describe a stale reading without clearing its usage", () => {
	const html = usage(80, Date.now() - 60_000);
	expect(html).toContain("Reset since this reading");
	expect(html).toContain("80% used");
	expect(usage(80, Date.now() + 3_600_000)).toContain("Resets in 1h");
	expect(usage(80, null)).not.toContain("Resets");
	expect(usage(80, Number.NaN)).not.toContain("Resets");
});

test("reading timestamps retain provenance and age", () => {
	const at = Date.now() - 2 * 86_400_000;
	expect(accountReadingLabel("Codex", at)).toBe(
		`Codex read this 2d ago, on ${new Date(at).toLocaleString()}.`,
	);
});
