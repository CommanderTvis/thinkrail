import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { StopReason } from "@thinkrail/contracts";

type FixtureMessage =
	| { role: "user"; text: string; timestamp: number }
	| {
			role: "assistant";
			text: string;
			timestamp: number;
			stopReason?: StopReason;
			errorMessage?: string;
	  };

export function defaultSessionDirFor(agentDir: string, cwd: string): string {
	const resolvedCwd = resolve(cwd);
	const resolvedAgentDir = resolve(agentDir);
	const safePath = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	return join(resolvedAgentDir, "sessions", safePath);
}

export function writeFixtureSession(
	dir: string,
	opts: {
		id?: string;
		cwd: string;
		name?: string;
		messages: FixtureMessage[];
	},
): { id: string; path: string } {
	mkdirSync(dir, { recursive: true });

	const sessionId = opts.id ?? `sess-${randomUUID()}`;
	const entryId = (suffix: string) => `${sessionId}-${suffix}`;
	let parentId: string | null = null;
	const lines: string[] = [
		JSON.stringify({
			type: "session",
			version: 3,
			id: sessionId,
			timestamp: new Date(opts.messages[0]?.timestamp ?? Date.now()).toISOString(),
			cwd: opts.cwd,
		}),
	];

	if (opts.name !== undefined) {
		const id = entryId("info");
		lines.push(
			JSON.stringify({
				type: "session_info",
				id,
				parentId,
				timestamp: new Date().toISOString(),
				name: opts.name,
			}),
		);
		parentId = id;
	}

	opts.messages.forEach((message, index) => {
		const id = entryId(`m${index}`);
		const content =
			message.role === "assistant" ? [{ type: "text", text: message.text }] : message.text;
		lines.push(
			JSON.stringify({
				type: "message",
				id,
				parentId,
				timestamp: new Date(message.timestamp).toISOString(),
				message: {
					role: message.role,
					content,
					timestamp: message.timestamp,
					...(message.role === "assistant" && message.stopReason
						? { stopReason: message.stopReason }
						: {}),
					...(message.role === "assistant" && message.errorMessage !== undefined
						? { errorMessage: message.errorMessage }
						: {}),
				},
			}),
		);
		parentId = id;
	});

	const path = join(dir, `${opts.messages[0]?.timestamp ?? Date.now()}_${sessionId}.jsonl`);
	writeFileSync(path, `${lines.join("\n")}\n`);
	return { id: sessionId, path };
}
