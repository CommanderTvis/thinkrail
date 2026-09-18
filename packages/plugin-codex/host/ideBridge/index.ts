import { randomUUID } from "node:crypto";
import { connectRouter } from "./connection";
import { failure, record, send } from "./protocol";

export function startIdeBridge(options: {
	path: string;
	canHandle: (workspaceRoot: string) => boolean;
	context: (workspaceRoot: string) => Promise<unknown>;
	warn: (error: unknown) => void;
}): () => void {
	return connectRouter(
		options.path,
		(socket) => {
			send(socket, {
				type: "request",
				requestId: randomUUID(),
				sourceClientId: "thinkrail",
				method: "initialize",
				version: 0,
				params: { clientType: "vscode" },
			});
		},
		(socket, message) => {
			const request =
				message.type === "client-discovery-request" ? record(message.request) : message;
			const root = record(request?.params)?.workspaceRoot;
			const supported = request?.method === "ide-context" && (request.version ?? 0) === 0;
			const eligible = supported && typeof root === "string" && options.canHandle(root);
			if (message.type === "client-discovery-request" && message.requestId) {
				send(socket, {
					type: "client-discovery-response",
					requestId: message.requestId,
					response: { canHandle: eligible },
				});
			} else if (message.type === "request" && message.requestId) {
				const requestId = message.requestId;
				if ((message.version ?? 0) !== 0) failure(socket, requestId, "request-version-mismatch");
				else if (!eligible || typeof root !== "string")
					failure(socket, requestId, "no-handler-for-request");
				else
					void options
						.context(root)
						.then((ideContext) => {
							send(socket, {
								type: "response",
								requestId,
								resultType: "success",
								result: { ideContext },
							});
						})
						.catch(() => failure(socket, requestId, "no-client-found"));
			}
		},
		options.warn,
	);
}
