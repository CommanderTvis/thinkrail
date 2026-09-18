import { expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { TERMINAL_IMAGE_MAX_BYTES } from "@thinkrail/contracts";
import { createClipboardImages } from "./clipboardImages";

const png =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";

test("clipboard images preserve bytes, use private unique paths, and clean up together", () => {
	const images = createClipboardImages();
	const first = images.save(png, "image/png");
	try {
		const second = images.save(png, "image/png");
		expect(second).not.toBe(first);
		expect(readFileSync(first).toString("base64")).toBe(png);
		if (process.platform !== "win32") {
			expect(statSync(first).mode & 0o777).toBe(0o600);
			expect(statSync(dirname(first)).mode & 0o777).toBe(0o700);
		}
	} finally {
		images.dispose();
	}
	expect(existsSync(dirname(first))).toBe(false);
	images.dispose();
});

test("invalid, mismatched and oversized image payloads are refused", () => {
	const images = createClipboardImages();
	try {
		expect(() => images.save(`${png}!`, "image/png")).toThrow("encoding");
		expect(() => images.save(png, "image/jpeg")).toThrow("Unsupported");
		expect(() => images.save(Buffer.from("echo unsafe").toString("base64"), "image/png")).toThrow(
			"Unsupported",
		);
		expect(() =>
			images.save("A".repeat(Math.ceil(TERMINAL_IMAGE_MAX_BYTES / 3) * 4 + 4), "image/png"),
		).toThrow("10 MiB");
	} finally {
		images.dispose();
	}
});
