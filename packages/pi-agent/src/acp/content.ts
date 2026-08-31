import type { ContentBlock, ToolCallContent } from "@agentclientprotocol/sdk";
import type { ImageContent } from "@earendil-works/pi-ai";

export interface PiPrompt {
	text: string;
	images: ImageContent[];
}

export function toPiPrompt(blocks: readonly ContentBlock[]): PiPrompt {
	const parts: string[] = [];
	const images: ImageContent[] = [];
	for (const block of blocks) {
		switch (block.type) {
			case "text":
				parts.push(block.text);
				break;
			case "image":
				images.push({ type: "image", data: block.data, mimeType: block.mimeType });
				break;
			case "resource_link":
				parts.push(`@${block.uri}`);
				break;
			case "resource": {
				const resource = block.resource;
				if ("text" in resource)
					parts.push(`<resource uri="${resource.uri}">
${resource.text}
</resource>`);
				break;
			}
			default:
				break;
		}
	}
	return { text: parts.join("\n\n"), images };
}

export function toolResultContent(result: unknown): ToolCallContent[] {
	const out: ToolCallContent[] = [];
	if (typeof result === "string") {
		if (result.length > 0) out.push({ type: "content", content: { type: "text", text: result } });
		return out;
	}
	if (typeof result !== "object" || result === null) return out;
	const blocks = (result as { content?: unknown }).content;
	if (!Array.isArray(blocks)) return out;
	for (const block of blocks) {
		if (typeof block !== "object" || block === null) continue;
		const view = block as { type?: unknown; text?: unknown; data?: unknown; mimeType?: unknown };
		if (view.type === "text" && typeof view.text === "string") {
			out.push({ type: "content", content: { type: "text", text: view.text } });
			continue;
		}
		if (
			view.type === "image" &&
			typeof view.data === "string" &&
			typeof view.mimeType === "string"
		) {
			out.push({
				type: "content",
				content: { type: "image", data: view.data, mimeType: view.mimeType },
			});
		}
	}
	return out;
}

export function partialResultContent(partial: unknown): ToolCallContent[] {
	if (typeof partial === "string") {
		return partial.length > 0
			? [{ type: "content", content: { type: "text", text: partial } }]
			: [];
	}
	return toolResultContent(partial);
}
