import type { Socket } from "node:net";

export type Message = Record<string, unknown> & { type: string; requestId?: string };
const MAX_FRAME = 8 * 1024 * 1024;

export function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function send(socket: Socket, message: Message): void {
	if (socket.destroyed || !socket.writable) return;
	const body = Buffer.from(JSON.stringify(message));
	if (body.length > MAX_FRAME) {
		socket.destroy();
		return;
	}
	const header = Buffer.alloc(4);
	header.writeUInt32LE(body.length);
	socket.write(Buffer.concat([header, body]));
}

export function read(socket: Socket, receive: (message: Message) => void): void {
	let buffer = Buffer.alloc(0);
	let timer: ReturnType<typeof setTimeout> | undefined;
	socket.on("error", () => socket.destroy());
	socket.on("close", () => clearTimeout(timer));
	socket.on("data", (chunk: Buffer) => {
		buffer = Buffer.concat([buffer, chunk]);
		while (buffer.length >= 4) {
			const size = buffer.readUInt32LE();
			if (size > MAX_FRAME) {
				socket.destroy();
				return;
			}
			if (buffer.length < size + 4) break;
			const body = buffer.subarray(4, size + 4);
			buffer = buffer.subarray(size + 4);
			try {
				const value = record(JSON.parse(body.toString("utf8")));
				if (
					!value ||
					typeof value.type !== "string" ||
					(value.requestId !== undefined && typeof value.requestId !== "string")
				) {
					socket.destroy();
					return;
				}
				receive(value as Message);
			} catch {
				socket.destroy();
				return;
			}
		}
		clearTimeout(timer);
		if (buffer.length) timer = setTimeout(() => socket.destroy(), 5000);
	});
}

export function failure(socket: Socket, requestId: string, error: string): void {
	send(socket, { type: "response", requestId, resultType: "error", error });
}
