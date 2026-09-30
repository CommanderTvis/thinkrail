import { createServer, request, type Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

type Frame = Record<string, unknown>;
type Tap = {
	toHost?: (frame: Frame, raw: string) => "drop" | undefined;
	toApp?: (frame: Frame, raw: string, deliver: () => void) => "hold" | undefined;
};

function parse(raw: string): Frame {
	try {
		const frame: unknown = JSON.parse(raw);
		return frame !== null && typeof frame === "object" ? (frame as Frame) : {};
	} catch {
		return {};
	}
}

export class WireProxy {
	private readonly taps = new Set<Tap>();
	private gate: Promise<void> | null = null;
	connections = 0;
	private readonly server: Server;
	private readonly sockets = new WebSocketServer({ noServer: true });

	constructor(
		readonly port: number,
		private readonly hostPort: number,
	) {
		this.server = createServer((incoming, outgoing) => {
			const upstream = request(
				{ host: "127.0.0.1", port: hostPort, path: incoming.url, method: incoming.method, headers: incoming.headers },
				(response) => {
					outgoing.writeHead(response.statusCode ?? 502, response.headers);
					response.pipe(outgoing);
				},
			);
			upstream.on("error", () => outgoing.destroy());
			incoming.pipe(upstream);
		});
		this.server.on("upgrade", async (incoming, socket, head) => {
			if (this.connections > 0 && this.gate) await this.gate;
			this.connections += 1;
			this.sockets.handleUpgrade(incoming, socket, head, (app) => this.bridge(app, incoming.url ?? "/ws"));
		});
	}

	listen(): Promise<void> {
		return new Promise((resolve) => this.server.listen(this.port, "127.0.0.1", resolve));
	}

	close(): Promise<void> {
		for (const client of this.sockets.clients) client.terminate();
		return new Promise((resolve) => this.server.close(() => resolve()));
	}

	sendToApp(frame: unknown): void {
		const raw = typeof frame === "string" ? frame : JSON.stringify(frame);
		for (const client of this.sockets.clients) client.send(raw);
	}

	disconnect(): void {
		for (const client of this.sockets.clients) client.close();
	}

	holdReconnects(): () => void {
		let release = () => {};
		this.gate = new Promise((resolve) => {
			release = () => {
				this.gate = null;
				resolve();
			};
		});
		return release;
	}

	tap(tap: Tap): () => void {
		this.taps.add(tap);
		return () => this.taps.delete(tap);
	}

	private bridge(app: WebSocket, path: string): void {
		const host = new WebSocket(`ws://127.0.0.1:${this.hostPort}${path}`);
		const queued: string[] = [];
		host.on("open", () => {
			for (const raw of queued.splice(0)) host.send(raw);
		});
		app.on("message", (data) => {
			const raw = String(data);
			const frame = parse(raw);
			for (const tap of this.taps) if (tap.toHost?.(frame, raw) === "drop") return;
			if (host.readyState === WebSocket.OPEN) host.send(raw);
			else queued.push(raw);
		});
		host.on("message", (data) => {
			const raw = String(data);
			const frame = parse(raw);
			const deliver = () => {
				if (app.readyState === WebSocket.OPEN) app.send(raw);
			};
			for (const tap of this.taps) if (tap.toApp?.(frame, raw, deliver) === "hold") return;
			deliver();
		});
		app.on("close", () => host.close());
		host.on("close", () => app.close());
		host.on("error", () => app.close());
	}
}

export function signal(): { received: Promise<void>; send: () => void } {
	let send = () => {};
	const received = new Promise<void>((resolve) => {
		send = resolve;
	});
	return { received, send };
}
