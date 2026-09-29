import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { Popover, PopoverTrigger } from "./popover";
import { IconTooltip, TooltipProvider } from "./tooltip";

function renderTriggerPair(wrapTrigger: boolean): string {
	return renderToStaticMarkup(
		<TooltipProvider>
			<Popover open>
				<IconTooltip label="Search open tabs" wrapTrigger={wrapTrigger}>
					<PopoverTrigger data-testid="shared-trigger">Search</PopoverTrigger>
				</IconTooltip>
			</Popover>
		</TooltipProvider>,
	);
}

const triggerState = (markup: string) =>
	markup
		.match(/<button[^>]*data-testid="shared-trigger"[^>]*>/)?.[0]
		.match(/data-state="([^"]+)"/)?.[1];

describe("IconTooltip over another Radix trigger", () => {
	test("wrapTrigger leaves the popover's data-state on the shared button", () => {
		expect(triggerState(renderTriggerPair(true))).toBe("open");
	});

	test("merging onto the child is what overwrites it", () => {
		expect(triggerState(renderTriggerPair(false))).not.toBe("open");
	});
});

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

test("no call site hand-rolls the wrapper span", () => {
	const files = ["apps/web/src", "packages/*/src", "packages/*/web"].flatMap((root) => [
		...new Bun.Glob(`${root}/**/*.tsx`).scanSync({ cwd: ROOT }),
	]);
	expect(files).toContain("packages/plugin-ui/src/tooltip.tsx");
	const offenders = files.filter(
		(path) =>
			!path.endsWith(".test.tsx") &&
			/<IconTooltip[^>]*>\s*<span className="flex">/.test(readFileSync(join(ROOT, path), "utf8")),
	);
	expect(offenders).toEqual([]);
});
