/**
 * Mirrors `apps/web/src/chat/toolRegistry.tsx`'s `ToolRenderProps` field-for-field, so a host's chat tool
 * renderer type is structurally identical to this one and every existing call site keeps compiling
 * unchanged. The kit cannot import that module directly (it is chat-internal). See SPEC.md.
 */
export interface VisualizationToolProps {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	result: unknown;
	status: "running" | "done" | "error";
	workspaceRoot?: string | undefined;
	onOpenFile?: ((path: string) => void) | undefined;
	streaming: boolean;
	interactive?: boolean;
	onRender?: ((error: string | null) => void) | undefined;
}

function toolValueText(value: unknown): string {
	if (value == null) return "";
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

export function resultText(result: unknown): string {
	if (result == null || typeof result === "string") return toolValueText(result);
	if (typeof result !== "object" || !("content" in result)) return toolValueText(result);
	const content = (result as { content: unknown }).content;
	if (!Array.isArray(content)) return toolValueText(result);
	const text: string[] = [];
	for (const block of content) {
		if (typeof block !== "object" || block === null) continue;
		const candidate = block as { type?: unknown; text?: unknown };
		if (candidate.type === "text" && typeof candidate.text === "string") text.push(candidate.text);
	}
	return text.join("");
}

export function strArg(args: Record<string, unknown>, key: string): string {
	const v = args[key];
	return typeof v === "string" ? v : "";
}
