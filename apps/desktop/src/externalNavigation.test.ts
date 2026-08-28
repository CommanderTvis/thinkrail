import { expect, test } from "bun:test";
import { externalNavigationUrl } from "./externalNavigation";

const origin = "http://127.0.0.1:24242";

test("keeps same-origin navigation inside the webview", () => {
	expect(externalNavigationUrl(`${origin}/#/v1`, origin)).toBeNull();
	expect(externalNavigationUrl({ url: `${origin}/files/a/b` }, origin)).toBeNull();
});

test("the app's own host is not external under its other loopback names", () => {
	expect(externalNavigationUrl("http://localhost:24242/#/v1", origin)).toBeNull();
	expect(externalNavigationUrl("http://[::1]:24242/files/a/b", origin)).toBeNull();
	expect(externalNavigationUrl("http://localhost:9999/#/v1", origin)).toBe(
		"http://localhost:9999/#/v1",
	);
	expect(externalNavigationUrl("https://localhost:24242/#/v1", origin)).toBe(
		"https://localhost:24242/#/v1",
	);
});

test("opens reviewed external protocols only", () => {
	expect(externalNavigationUrl("https://example.com/docs", origin)).toBe(
		"https://example.com/docs",
	);
	expect(externalNavigationUrl({ url: "mailto:hello@thinkrail.ai" }, origin)).toBe(
		"mailto:hello@thinkrail.ai",
	);
	expect(externalNavigationUrl("file:///tmp/private", origin)).toBeNull();
	expect(externalNavigationUrl("javascript:alert(1)", origin)).toBeNull();
});

test("rejects malformed event detail", () => {
	expect(externalNavigationUrl(null, origin)).toBeNull();
	expect(externalNavigationUrl({}, origin)).toBeNull();
});
