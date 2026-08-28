/** A stretch of a file the user has highlighted, in the shape both the chat and the editor speak. */
export interface EditorSelection {
	path: string;
	text: string;
	startLine: number;
	endLine: number;
	language: string;
}

export function selectionLines(selection: Pick<EditorSelection, "startLine" | "endLine">): string {
	return selection.startLine === selection.endLine
		? `${selection.startLine}`
		: `${selection.startLine}-${selection.endLine}`;
}

/** `path:lines` over a fenced block: what an agent needs to know which part of the file is meant. */
export function selectionQuote(selection: EditorSelection): string {
	return `${selection.path}:${selectionLines(selection)}\n\`\`\`${selection.language}\n${selection.text}\n\`\`\``;
}
