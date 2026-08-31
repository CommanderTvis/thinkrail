import type { McpServerOffer } from "@thinkrail/acp";
import type { ChatCapabilities } from "@thinkrail/contracts";
import type { McpToolServer } from "./ports";

export function mcpOffer(
	capabilities: ChatCapabilities,
	server: McpToolServer | null,
): McpServerOffer | undefined {
	if (server === null) return undefined;
	switch (capabilities.mcpTools) {
		case "acp":
			return { kind: "acp", name: server.name, serverId: server.serverId };
		case "http": {
			const http = server.httpEndpoint();
			if (http === null) return undefined;
			return {
				kind: "http",
				name: server.name,
				url: http.url,
				...(http.headers === undefined ? {} : { headers: http.headers }),
			};
		}
		case "native":
		case "none":
			return undefined;
	}
}
