import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import type { SessionRecord } from "@thinkrail/contracts";
import type { TranscriptPaths } from "./paths";

export const TRANSCRIPT_META_VERSION = 1;

export interface TranscriptMeta {
	v: number;
	record: SessionRecord;
	logBytes: number;
}

export async function readMeta(paths: TranscriptPaths): Promise<TranscriptMeta | null> {
	let raw: string;
	try {
		raw = await readFile(paths.meta, "utf8");
	} catch {
		return null;
	}
	try {
		const parsed = JSON.parse(raw) as TranscriptMeta;
		if (parsed.v !== TRANSCRIPT_META_VERSION) return null;
		if (typeof parsed.logBytes !== "number") return null;
		if (typeof parsed.record?.sessionId !== "string") return null;
		return parsed;
	} catch {
		return null;
	}
}

export async function writeMeta(paths: TranscriptPaths, meta: TranscriptMeta): Promise<void> {
	try {
		await writeFile(paths.metaTemp, `${JSON.stringify(meta, null, "\t")}\n`);
		await rename(paths.metaTemp, paths.meta);
	} catch (error) {
		await unlink(paths.metaTemp).catch(() => undefined);
		throw error;
	}
}

export async function logSize(paths: TranscriptPaths): Promise<number> {
	try {
		return (await stat(paths.log)).size;
	} catch {
		return 0;
	}
}
