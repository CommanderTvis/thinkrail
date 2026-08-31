import { appendFile, readFile, truncate } from "node:fs/promises";
import { type DecodedLog, decodeLog } from "./format";
import type { TranscriptPaths } from "./paths";

const FLUSH_MS = 1000;
const FLUSH_BYTES = 16 * 1024;

export interface LoadedLog extends DecodedLog {
	bytes: number;
}

export async function loadLog(paths: TranscriptPaths, repair: boolean): Promise<LoadedLog | null> {
	let text: string;
	try {
		text = await readFile(paths.log, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	const decoded = decodeLog(text);
	const fileBytes = Buffer.byteLength(text, "utf8");
	if (repair && decoded.completeBytes !== fileBytes) {
		await truncate(paths.log, decoded.completeBytes);
	}
	return { ...decoded, bytes: repair ? decoded.completeBytes : fileBytes };
}

export class TranscriptAppender {
	private pending: string[] = [];
	private pendingBytes = 0;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private due = 0;
	private chain: Promise<void> = Promise.resolve();
	private written: number;

	constructor(
		private readonly path: string,
		bytes: number,
		private readonly onError: (error: unknown) => void,
	) {
		this.written = bytes;
	}

	get bytes(): number {
		return this.written;
	}

	append(encoded: string, immediate: boolean): void {
		this.pending.push(encoded);
		this.pendingBytes += Buffer.byteLength(encoded, "utf8");
		this.schedule(immediate || this.pendingBytes >= FLUSH_BYTES ? 0 : FLUSH_MS);
	}

	flush(): Promise<void> {
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		if (this.pending.length === 0) return this.chain;
		const payload = this.pending.join("");
		const size = this.pendingBytes;
		this.pending = [];
		this.pendingBytes = 0;
		const write = this.chain.then(async () => {
			await appendFile(this.path, payload, "utf8");
			this.written += size;
		});
		this.chain = write.catch(() => undefined);
		return write;
	}

	private schedule(delay: number): void {
		const at = Date.now() + delay;
		if (this.timer !== null && this.due <= at) return;
		if (this.timer !== null) clearTimeout(this.timer);
		this.due = at;
		const timer = setTimeout(() => {
			this.timer = null;
			this.flush().catch(this.onError);
		}, delay);
		timer.unref();
		this.timer = timer;
	}
}
