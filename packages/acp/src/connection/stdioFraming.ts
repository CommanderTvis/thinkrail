export const DIAGNOSTIC_TAIL_LIMIT = 8_000;

export class Tail {
	readonly #limit: number;
	#text = "";

	constructor(limit: number = DIAGNOSTIC_TAIL_LIMIT) {
		this.#limit = limit;
	}

	push(chunk: string): void {
		if (chunk.length === 0) return;
		const joined = this.#text + chunk;
		this.#text = joined.length <= this.#limit ? joined : joined.slice(-this.#limit);
	}

	text(): string {
		return this.#text;
	}
}

export interface ByteSink {
	write(chunk: Uint8Array): number | Promise<number>;
	flush(): number | Promise<number>;
	end(error?: Error): number | Promise<number>;
}

export function fileSinkWritable(sink: ByteSink): WritableStream<Uint8Array> {
	return new WritableStream<Uint8Array>({
		async write(chunk) {
			await sink.write(chunk);
			await sink.flush();
		},
		close() {
			sink.end();
		},
		abort() {
			sink.end();
		},
	});
}

export function endStdin(stream: WritableStream<Uint8Array>): void {
	if (stream.locked) return;
	void stream.close().catch(() => undefined);
}

export function filterJsonLines(
	source: ReadableStream<Uint8Array>,
	onNoise: (line: string) => void,
): ReadableStream<Uint8Array> {
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

	const emit = (controller: ReadableStreamDefaultController<Uint8Array>, line: string): void => {
		const trimmed = line.trim();
		if (trimmed.length === 0) return;
		// Only a "{" line is a frame; "[" is noise by design — see SPEC.md.
		if (trimmed.startsWith("{")) {
			controller.enqueue(encoder.encode(`${trimmed}\n`));
			return;
		}
		onNoise(trimmed);
	};

	return new ReadableStream<Uint8Array>({
		async start(controller) {
			const active = source.getReader();
			reader = active;
			let pending = "";
			try {
				for (;;) {
					const { value, done } = await active.read();
					if (done) break;
					if (value === undefined) continue;
					pending += decoder.decode(value, { stream: true });
					let newline = pending.indexOf("\n");
					while (newline >= 0) {
						emit(controller, pending.slice(0, newline));
						pending = pending.slice(newline + 1);
						newline = pending.indexOf("\n");
					}
				}
				emit(controller, pending + decoder.decode());
			} catch (error) {
				controller.error(error);
				return;
			} finally {
				active.releaseLock();
			}
			controller.close();
		},
		cancel(reason) {
			return reader?.cancel(reason);
		},
	});
}

export async function drainToTail(source: ReadableStream<Uint8Array>, tail: Tail): Promise<void> {
	const decoder = new TextDecoder();
	const reader = source.getReader();
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			if (value !== undefined) tail.push(decoder.decode(value, { stream: true }));
		}
		tail.push(decoder.decode());
	} catch {
	} finally {
		reader.releaseLock();
	}
}
