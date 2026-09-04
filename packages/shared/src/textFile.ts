import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import type { FileWriteResult } from "@thinkrail/contracts";

export function contentHash(content: string): string {
	return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}

export function readFileAt(abs: string): { content: string; hash: string } {
	const content = readFileSync(abs, "utf8");
	return { content, hash: contentHash(content) };
}

export function writeFileAt(abs: string, content: string, baseHash: string): FileWriteResult {
	let disk: { content: string; hash: string };
	try {
		disk = readFileAt(abs);
	} catch {
		disk = { content: "", hash: contentHash("") };
	}
	if (disk.hash !== baseHash) return { written: false, disk };
	writeFileSync(abs, content, "utf8");
	return { written: true, hash: contentHash(content) };
}
