import type { ToolKind } from "@agentclientprotocol/sdk";

const KIND_BY_TOOL: { readonly [tool: string]: ToolKind } = {
	read: "read",
	list: "read",
	glob: "search",
	grep: "search",
	rg: "search",
	edit: "edit",
	multi_edit: "edit",
	write: "edit",
	bash: "execute",
	bash_output: "execute",
	kill_shell: "execute",
	web_search: "fetch",
	web_fetch: "fetch",
	think: "think",
	todo_write: "think",
	todo_read: "read",
	visualize: "other",
	ask_user_question: "other",
};

const KIND_BY_PREFIX: readonly (readonly [string, ToolKind])[] = [
	["spec_", "search"],
	["todo_", "think"],
	["web_", "fetch"],
];

export function toolKindOf(toolName: string): ToolKind {
	const exact = KIND_BY_TOOL[toolName];
	if (exact !== undefined) return exact;
	for (const [prefix, kind] of KIND_BY_PREFIX) {
		if (toolName.startsWith(prefix)) return kind;
	}
	return "other";
}

export function toolTitleOf(toolName: string, args: unknown): string {
	if (typeof args !== "object" || args === null) return toolName;
	const record = args as { [key: string]: unknown };
	for (const key of ["path", "file_path", "filePath", "pattern", "command", "query", "id"]) {
		const value = record[key];
		if (typeof value === "string" && value.length > 0) return `${toolName}(${value})`;
	}
	return toolName;
}

export function toolLocationsOf(args: unknown): { path: string }[] {
	if (typeof args !== "object" || args === null) return [];
	const record = args as { [key: string]: unknown };
	for (const key of ["path", "file_path", "filePath"]) {
		const value = record[key];
		if (typeof value === "string" && value.length > 0) return [{ path: value }];
	}
	return [];
}
