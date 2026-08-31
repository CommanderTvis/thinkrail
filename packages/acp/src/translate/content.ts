import type { ContentBlock, ToolCallContent } from "@agentclientprotocol/sdk";
import type { ChatBlock, ImageBlock, PromptContent, ToolOutput } from "@thinkrail/contracts";
import type { DeclaredVariants } from "./guards";
import {
	asArray,
	asFilledString,
	asNumber,
	asRecord,
	asString,
	assertNever,
	isVariant,
} from "./guards";

export const CONTENT_BLOCK_TYPES: DeclaredVariants<ContentBlock["type"]> = {
	text: true,
	image: true,
	audio: true,
	resource_link: true,
	resource: true,
};

export const TOOL_CALL_CONTENT_TYPES: DeclaredVariants<ToolCallContent["type"]> = {
	content: true,
	diff: true,
	terminal: true,
};

export function toPromptContent(block: unknown): PromptContent | undefined {
	const raw = asRecord(block);
	if (raw === undefined) return undefined;
	if (!isVariant(raw.type, CONTENT_BLOCK_TYPES)) return undefined;
	switch (raw.type) {
		case "text": {
			const text = asString(raw.text);
			return text === undefined ? undefined : { type: "text", text };
		}
		case "image": {
			const data = asString(raw.data);
			const mimeType = asString(raw.mimeType);
			if (data === undefined || mimeType === undefined) return undefined;
			const uri = asFilledString(raw.uri);
			const image: ImageBlock = {
				type: "image",
				data,
				mimeType,
				...(uri !== undefined ? { uri } : {}),
			};
			return image;
		}
		case "audio":
			return undefined;
		case "resource_link": {
			const uri = asString(raw.uri);
			const name = asString(raw.name);
			if (uri === undefined || name === undefined) return undefined;
			const mimeType = asFilledString(raw.mimeType);
			const title = asFilledString(raw.title);
			const description = asFilledString(raw.description);
			const size = asNumber(raw.size);
			return {
				type: "resource",
				uri,
				name,
				...(mimeType !== undefined ? { mimeType } : {}),
				...(title !== undefined ? { title } : {}),
				...(description !== undefined ? { description } : {}),
				...(size !== undefined ? { size } : {}),
			};
		}
		case "resource": {
			const resource = asRecord(raw.resource);
			if (resource === undefined) return undefined;
			const uri = asString(resource.uri);
			if (uri === undefined) return undefined;
			const mimeType = asFilledString(resource.mimeType);
			const text = asString(resource.text);
			return {
				type: "resource",
				uri,
				name: uri,
				...(mimeType !== undefined ? { mimeType } : {}),
				...(text !== undefined ? { text } : {}),
			};
		}
		default:
			return assertNever(raw.type);
	}
}

export function toChatBlock(block: ContentBlock): ChatBlock | undefined {
	return toPromptContent(block);
}

export function toContentBlocks(content: readonly PromptContent[]): ContentBlock[] {
	const out: ContentBlock[] = [];
	for (const part of content) {
		switch (part.type) {
			case "text":
				out.push({ type: "text", text: part.text });
				break;
			case "image":
				out.push({
					type: "image",
					data: part.data,
					mimeType: part.mimeType,
					...(part.uri !== undefined ? { uri: part.uri } : {}),
				});
				break;
			case "resource":
				out.push(
					part.text !== undefined
						? {
								type: "resource",
								resource: {
									uri: part.uri,
									text: part.text,
									...(part.mimeType !== undefined ? { mimeType: part.mimeType } : {}),
								},
							}
						: {
								type: "resource_link",
								uri: part.uri,
								name: part.name,
								...(part.mimeType !== undefined ? { mimeType: part.mimeType } : {}),
								...(part.title !== undefined ? { title: part.title } : {}),
								...(part.description !== undefined ? { description: part.description } : {}),
								...(part.size !== undefined ? { size: part.size } : {}),
							},
				);
				break;
			default:
				assertNever(part);
		}
	}
	return out;
}

export function toToolOutput(content: readonly ToolCallContent[] | null | undefined): ToolOutput[] {
	const out: ToolOutput[] = [];
	for (const entry of asArray(content)) {
		const raw = asRecord(entry);
		if (raw === undefined) continue;
		if (!isVariant(raw.type, TOOL_CALL_CONTENT_TYPES)) continue;
		switch (raw.type) {
			case "content": {
				const part = toPromptContent(raw.content);
				if (part === undefined) continue;
				if (part.type === "text") out.push({ type: "text", text: part.text });
				else if (part.type === "image") {
					out.push({ type: "image", data: part.data, mimeType: part.mimeType });
				} else out.push({ type: "text", text: part.text ?? part.uri });
				break;
			}
			case "diff": {
				const path = asString(raw.path);
				const newText = asString(raw.newText);
				if (path === undefined || newText === undefined) continue;
				out.push({ type: "diff", path, oldText: asString(raw.oldText) ?? null, newText });
				break;
			}
			case "terminal": {
				const terminalId = asFilledString(raw.terminalId);
				if (terminalId === undefined) continue;
				out.push({ type: "terminal", terminalId });
				break;
			}
			default:
				assertNever(raw.type);
		}
	}
	return out;
}
