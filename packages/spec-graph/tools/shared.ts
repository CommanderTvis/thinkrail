import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AgentToolResult,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	truncateHead,
} from "@earendil-works/pi-coding-agent";
import type { Static, TObject } from "typebox";
import { SpecIndex, type SpecType } from "../core/index.ts";

const indexes = new Map<string, SpecIndex>();

export function getIndex(root: string): SpecIndex {
	let index = indexes.get(root);
	if (!index) {
		index = new SpecIndex(root);
		indexes.set(root, index);
	}
	return index;
}

export interface SpecToolOutcome<T> {
	text: string;
	details: T;
	/** Paging advice, kept past any truncation of `text`. */
	continuation?: string;
	isError?: boolean;
}

export interface SpecToolDef<P extends TObject, T> {
	name: string;
	label: string;
	description: string;
	promptSnippet: string;
	parameters: P;
	run(params: Static<P>, cwd: string): Promise<SpecToolOutcome<T>> | SpecToolOutcome<T>;
}

export function defineSpecTool<P extends TObject, T>(tool: SpecToolDef<P, T>): SpecToolDef<P, T> {
	return tool;
}

export function textResult<T>(text: string, details: T, continuation = ""): SpecToolOutcome<T> {
	return { text, details, ...(continuation ? { continuation } : {}) };
}

export function errorResult(message: string): SpecToolOutcome<{ error: string }> {
	const inline = `Error: ${message}`;
	const text = truncateHead(inline).truncated ? `Error:\n${message}` : inline;
	return { text, details: { error: message }, isError: true };
}

export function outcomeText(outcome: SpecToolOutcome<unknown>): string {
	return outcome.continuation ? `${outcome.text}\n${outcome.continuation}` : outcome.text;
}

export async function boundedResult<T>(outcome: SpecToolOutcome<T>): Promise<AgentToolResult<T>> {
	const { details, continuation = "" } = outcome;
	const text = outcomeText(outcome);
	const flag = outcome.isError ? { isError: true } : {};
	const preview = truncateHead(text);
	if (!preview.truncated) return { content: [{ type: "text", text }], details, ...flag };
	let fullOutputPath: string | undefined;
	let notice: string;
	try {
		const directory = await mkdtemp(join(tmpdir(), "pi-spec-output-"));
		const path = join(directory, "output.txt");
		await writeFile(path, text, { mode: 0o600 });
		fullOutputPath = path;
		notice = `Full output saved to: ${path}\nTemporary file; may expire. Read only relevant offset/limit ranges; use shell byte ranges for oversized single lines.`;
	} catch {
		notice =
			"Full output unavailable: temporary-file capture failed. Narrow a read query; do not repeat a mutation to retrieve its output.";
	}
	const footer = `\n\n[Output truncated: ${preview.totalLines} lines, ${preview.totalBytes} bytes total. ${notice}]${continuation ? `\n${continuation}` : ""}`;
	const bounded = truncateHead(text, {
		maxBytes: Math.max(0, DEFAULT_MAX_BYTES - Buffer.byteLength(footer)),
		maxLines: DEFAULT_MAX_LINES - footer.split("\n").length,
	});
	return {
		content: [{ type: "text", text: `${bounded.content}${footer}` }],
		details: {
			...details,
			output: {
				truncated: true,
				...(fullOutputPath ? { fullOutputPath } : { captureFailed: true }),
			},
		},
		...flag,
	};
}

const SCAFFOLD_HEADINGS: Record<SpecType, string[]> = {
	"module-design": ["Responsibility", "Boundary"],
	"submodule-design": ["Responsibility", "Boundary"],
	"architecture-design": ["Drivers", "Decisions", "Invariants", "Out of scope"],
	"goal-and-requirements": ["Goal", "Scope"],
	"task-spec": ["Purpose", "Open items"],
};

export function scaffoldBody(type: SpecType): string {
	const headings = SCAFFOLD_HEADINGS[type];
	if (!headings || headings.length === 0) return "";
	return `${headings.map((h) => `## ${h}\n`).join("\n")}`;
}
