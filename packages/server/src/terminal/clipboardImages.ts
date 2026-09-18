import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TERMINAL_IMAGE_MAX_BYTES } from "@thinkrail/contracts";

function extension(bytes: Buffer, mimeType: string): string {
	if (
		mimeType === "image/png" &&
		bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
	)
		return "png";
	if (mimeType === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
		return "jpg";
	if (mimeType === "image/gif" && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) return "gif";
	if (
		mimeType === "image/webp" &&
		bytes.subarray(0, 4).toString() === "RIFF" &&
		bytes.subarray(8, 12).toString() === "WEBP"
	)
		return "webp";
	throw new Error("Unsupported clipboard image. Use PNG, JPEG, GIF, or WebP.");
}

export function createClipboardImages() {
	let directory: string | undefined;
	let size = 0;
	return {
		save(data: string, mimeType: string): string {
			if (typeof data !== "string" || data.length > Math.ceil(TERMINAL_IMAGE_MAX_BYTES / 3) * 4)
				throw new Error("Clipboard images must be at most 10 MiB.");
			const bytes = Buffer.from(data, "base64");
			if (!bytes.length || bytes.toString("base64") !== data)
				throw new Error("Invalid clipboard image encoding.");
			if (bytes.length > TERMINAL_IMAGE_MAX_BYTES)
				throw new Error("Clipboard images must be at most 10 MiB.");
			const suffix = extension(bytes, mimeType);
			if (size + bytes.length > TERMINAL_IMAGE_MAX_BYTES * 10)
				throw new Error("This terminal's pasted images have reached 100 MiB. Open a new terminal.");
			directory ??= mkdtempSync(join(tmpdir(), "thinkrail-clipboard-"));
			const path = join(directory, `${randomUUID()}.${suffix}`);
			writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
			size += bytes.length;
			return path;
		},
		dispose() {
			if (directory) rmSync(directory, { recursive: true, force: true });
			directory = undefined;
			size = 0;
		},
	};
}
