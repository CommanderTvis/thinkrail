import { join } from "node:path";
import { dataDir } from "../persistence";

const SAFE_ID = /^[A-Za-z0-9_-]{1,120}$/;

export function transcriptsRootIn(dir: string): string {
	return join(dir, "transcripts");
}

export function transcriptsRoot(): string {
	return transcriptsRootIn(dataDir());
}

export interface TranscriptPaths {
	dir: string;
	log: string;
	meta: string;
	metaTemp: string;
}

export function sessionDirName(sessionId: string): string {
	if (!sessionId) throw new Error("Transcript session id must not be empty");
	return SAFE_ID.test(sessionId) ? sessionId : `~${Buffer.from(sessionId).toString("base64url")}`;
}

export function sessionIdFromDirName(name: string): string | null {
	if (SAFE_ID.test(name)) return name;
	if (!name.startsWith("~")) return null;
	const decoded = Buffer.from(name.slice(1), "base64url").toString("utf8");
	return decoded.length > 0 ? decoded : null;
}

export function transcriptPathsForDir(dir: string): TranscriptPaths {
	const meta = join(dir, "meta.json");
	return {
		dir,
		log: join(dir, "log.jsonl"),
		meta,
		metaTemp: `${meta}.${process.pid}.tmp`,
	};
}

export function transcriptPaths(root: string, sessionId: string): TranscriptPaths {
	return transcriptPathsForDir(join(root, sessionDirName(sessionId)));
}
