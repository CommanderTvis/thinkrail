import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { basename, join } from "node:path";
import type { AgentLaunchSpec, ProcessSpawner, SpawnedProcess } from "../connection";
import { spawnWithBun } from "../connection";
import type { FrameDirection, FrameRecord } from "./frames";
import { parseFrame } from "./frames";

export const ACP_RECORD_DIR_ENV = "THINKRAIL_ACP_RECORD_DIR";

export type EnvBag = { readonly [key: string]: string | undefined };

export interface FrameSink {
	write(direction: FrameDirection, raw: string): void;
	close(): void;
}

export interface RecordFramesOptions {
	dir: string;
	now?: () => number;
}

interface LineTee {
	push(bytes: Uint8Array): void;
	flush(): void;
}

export function jsonlFrameSink(path: string, now: () => number = Date.now): FrameSink {
	let handle: number | undefined = openSync(path, "a");
	return {
		write(direction, raw) {
			if (handle === undefined) return;
			const record: FrameRecord = { at: now(), direction, raw };
			writeSync(handle, `${JSON.stringify(record)}\n`);
		},
		close() {
			if (handle === undefined) return;
			closeSync(handle);
			handle = undefined;
		},
	};
}

function lineTee(onFrame: (line: string) => void): LineTee {
	const decoder = new TextDecoder();
	let pending = "";
	const emit = (line: string): void => {
		const trimmed = line.trim();
		if (parseFrame(trimmed) !== undefined) onFrame(trimmed);
	};
	return {
		push(bytes) {
			pending += decoder.decode(bytes, { stream: true });
			let newline = pending.indexOf("\n");
			while (newline >= 0) {
				emit(pending.slice(0, newline));
				pending = pending.slice(newline + 1);
				newline = pending.indexOf("\n");
			}
		},
		flush() {
			emit(pending + decoder.decode());
			pending = "";
		},
	};
}

function teeReadable(
	source: ReadableStream<Uint8Array>,
	onFrame: (line: string) => void,
	onEnd: () => void,
): ReadableStream<Uint8Array> {
	const tee = lineTee(onFrame);
	return source.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				tee.push(chunk);
				controller.enqueue(chunk);
			},
			flush() {
				tee.flush();
				onEnd();
			},
		}),
	);
}

function teeWritable(
	target: WritableStream<Uint8Array>,
	onFrame: (line: string) => void,
	onEnd: () => void,
): WritableStream<Uint8Array> {
	const tee = lineTee(onFrame);
	const writer = target.getWriter();
	return new WritableStream<Uint8Array>({
		async write(chunk) {
			tee.push(chunk);
			await writer.write(chunk);
		},
		async close() {
			tee.flush();
			onEnd();
			await writer.close();
		},
		async abort(reason) {
			tee.flush();
			onEnd();
			await writer.abort(reason);
		},
	});
}

export function recordProcess(child: SpawnedProcess, sink: FrameSink): SpawnedProcess {
	const pending = new Set(["stdin", "stdout"]);
	const finish = (side: string): void => {
		if (!pending.delete(side)) return;
		if (pending.size === 0) sink.close();
	};
	void child.exited.then(() => {
		finish("stdin");
	});
	return {
		stdin: teeWritable(
			child.stdin,
			(line) => {
				sink.write("out", line);
			},
			() => {
				finish("stdin");
			},
		),
		stdout: teeReadable(
			child.stdout,
			(line) => {
				sink.write("in", line);
			},
			() => {
				finish("stdout");
			},
		),
		stderr: child.stderr,
		exited: child.exited,
		kill: (signal) => {
			child.kill(signal);
		},
	};
}

let recordings = 0;

function recordingName(launch: AgentLaunchSpec, at: number): string {
	recordings += 1;
	const stamp = new Date(at).toISOString().replaceAll(/[:.]/g, "-");
	const agent = basename(launch.command).replaceAll(/[^A-Za-z0-9._-]/g, "_");
	return `${stamp}-${agent}-${recordings}.jsonl`;
}

export function recordFrames(inner: ProcessSpawner, options: RecordFramesOptions): ProcessSpawner {
	const now = options.now ?? Date.now;
	return (launch) => {
		mkdirSync(options.dir, { recursive: true });
		const sink = jsonlFrameSink(join(options.dir, recordingName(launch, now())), now);
		return recordProcess(inner(launch), sink);
	};
}

export function recordFramesFromEnv(
	inner: ProcessSpawner = spawnWithBun,
	env: EnvBag = Bun.env,
): ProcessSpawner {
	const dir = env[ACP_RECORD_DIR_ENV]?.trim();
	if (dir === undefined || dir.length === 0) return inner;
	return recordFrames(inner, { dir });
}
