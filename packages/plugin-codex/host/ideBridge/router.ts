import { randomUUID } from "node:crypto";
import type { Server, Socket } from "node:net";
import { failure, type Message, read, record, send } from "./protocol";

export function attachRouter(server: Server): () => void {
	const clients = new Map<Socket, { id: string; type: unknown }>();
	const sockets = new Set<Socket>();
	const pending = new Map<
		string,
		{ source: Socket; target: Socket; receive: (reply: Message) => void }
	>();
	function status(socket: Socket, state: "connected" | "disconnected") {
		const client = clients.get(socket);
		if (!client) return;
		for (const target of clients.keys()) {
			if (target !== socket)
				send(target, {
					type: "broadcast",
					method: "client-status-changed",
					sourceClientId: client.id,
					version: 0,
					params: { clientId: client.id, clientType: client.type, status: state },
				});
		}
	}

	function exchange(source: Socket, target: Socket, message: Message): Promise<Message> {
		return new Promise((resolve) => {
			const requestId = randomUUID();
			const done = (reply: Message) => {
				clearTimeout(timer);
				pending.delete(requestId);
				resolve(reply);
			};
			const timer = setTimeout(
				() => done({ type: "response", resultType: "error", error: "request-timeout" }),
				2000,
			);
			pending.set(requestId, { source, target, receive: done });
			send(target, { ...message, requestId });
		});
	}

	async function route(source: Socket, request: Message & { requestId: string }): Promise<void> {
		const candidates = [...clients].filter(
			([socket, client]) =>
				socket !== source && (!request.targetClientId || request.targetClientId === client.id),
		);
		try {
			const target = await Promise.any(
				candidates.map(async ([socket]) => {
					const reply = await exchange(source, socket, {
						type: "client-discovery-request",
						request,
					});
					if (record(reply.response)?.canHandle !== true) throw new Error("unavailable");
					return socket;
				}),
			);
			if (source.destroyed) return;
			if (target.destroyed) {
				failure(source, request.requestId, "client-disconnected");
				return;
			}
			const reply = await exchange(source, target, request);
			send(source, { ...reply, requestId: request.requestId });
		} catch {
			failure(source, request.requestId, "no-client-found");
		}
	}

	server.on("connection", (socket) => {
		sockets.add(socket);
		read(socket, (message) => {
			if (message.type === "request" && message.requestId) {
				if (message.method === "initialize") {
					const client = clients.get(socket) ?? {
						id: randomUUID(),
						type: record(message.params)?.clientType,
					};
					clients.set(socket, client);
					status(socket, "connected");
					send(socket, {
						type: "response",
						requestId: message.requestId,
						resultType: "success",
						method: "initialize",
						handledByClientId: client.id,
						result: { clientId: client.id },
					});
				} else void route(socket, { ...message, requestId: message.requestId });
			} else if (
				(message.type === "response" || message.type === "client-discovery-response") &&
				message.requestId
			) {
				const request = pending.get(message.requestId);
				if (request?.target === socket) request.receive(message);
			} else if (message.type === "broadcast" && clients.has(socket)) {
				for (const target of clients.keys())
					if (target !== socket)
						send(target, { ...message, sourceClientId: clients.get(socket)?.id });
			}
		});
		socket.on("close", () => {
			sockets.delete(socket);
			status(socket, "disconnected");
			clients.delete(socket);
			for (const request of pending.values()) {
				if (request.source === socket || request.target === socket)
					request.receive({ type: "response", resultType: "error", error: "client-disconnected" });
			}
		});
	});
	return () => {
		for (const request of pending.values())
			request.receive({ type: "response", resultType: "error", error: "server-closed" });
		for (const socket of sockets) socket.destroy();
	};
}
