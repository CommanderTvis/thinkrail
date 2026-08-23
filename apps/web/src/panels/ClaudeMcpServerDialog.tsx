import type { ClaudeEdit, ClaudeMcpServerDraft, ClaudeMcpTransport } from "@thinkrail/contracts";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { ComposeActions, FIELD_CLASS, Field } from "./ClaudeConfigParts";
import { ToggleSegment } from "./ToggleSegment";

const TRANSPORTS: { value: ClaudeMcpTransport; label: string }[] = [
	{ value: "stdio", label: "Command" },
	{ value: "http", label: "HTTP" },
	{ value: "sse", label: "SSE" },
];

function lines(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
}

/** `KEY=value` for environment, `Name: value` for headers — the two shapes people already have to hand. */
function pairs(text: string, separator: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of lines(text)) {
		const at = line.indexOf(separator);
		if (at <= 0) continue;
		out[line.slice(0, at).trim()] = line.slice(at + separator.length).trim();
	}
	return out;
}

/** Describe a server, before anything is asked about where it goes — see panels/SPEC.md. */
export function ClaudeMcpServerDialog({
	open,
	onClose,
	onCompose,
}: {
	open: boolean;
	onClose: () => void;
	onCompose: (pending: { edit: ClaudeEdit; title: string }) => void;
}) {
	const [name, setName] = useState("");
	const [transport, setTransport] = useState<ClaudeMcpTransport>("stdio");
	const [command, setCommand] = useState("");
	const [args, setArgs] = useState("");
	const [url, setUrl] = useState("");
	const [headers, setHeaders] = useState("");
	const [env, setEnv] = useState("");

	const problem =
		name.trim() === ""
			? "A name is needed."
			: /\s/.test(name.trim())
				? "A server name cannot contain spaces."
				: transport === "stdio" && command.trim() === ""
					? "A command is needed."
					: transport !== "stdio" && url.trim() === ""
						? "A URL is needed."
						: null;

	const submit = () => {
		if (problem) return;
		const draft: ClaudeMcpServerDraft =
			transport === "stdio"
				? { transport, command: command.trim(), args: lines(args) }
				: { transport, url: url.trim(), headers: pairs(headers, ":") };
		onCompose({
			edit: {
				kind: "mcp-add",
				server: name.trim(),
				draft: { ...draft, env: pairs(env, "=") },
			},
			title: `Add the MCP server "${name.trim()}"`,
		});
	};

	return (
		<Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
			<DialogContent className="flex max-h-[80vh] w-full max-w-[36rem] flex-col gap-12 overflow-auto">
				<DialogHeader>
					<DialogTitle>Add an MCP server</DialogTitle>
				</DialogHeader>

				<Field label="Name">
					<input
						value={name}
						onChange={(event) => setName(event.target.value)}
						spellCheck={false}
						autoFocus
						aria-label="Server name"
						data-testid="claude-mcp-name"
						placeholder="git"
						className={FIELD_CLASS}
					/>
				</Field>

				<Field label="How it runs">
					<div className="flex items-center gap-8">
						{TRANSPORTS.map((option) => (
							<ToggleSegment
								key={option.value}
								testid={`claude-mcp-transport-${option.value}`}
								label={option.label}
								active={transport === option.value}
								onClick={() => setTransport(option.value)}
							/>
						))}
					</div>
				</Field>

				{transport === "stdio" ? (
					<>
						<Field label="Command">
							<input
								value={command}
								onChange={(event) => setCommand(event.target.value)}
								spellCheck={false}
								aria-label="Command"
								data-testid="claude-mcp-command"
								placeholder="uvx"
								className={FIELD_CLASS}
							/>
						</Field>
						<Field label="Arguments" hint="One per line.">
							<textarea
								value={args}
								onChange={(event) => setArgs(event.target.value)}
								rows={3}
								spellCheck={false}
								aria-label="Arguments"
								data-testid="claude-mcp-args"
								placeholder={"mcp-server-git\n--repository\n."}
								className={`resize-y ${FIELD_CLASS}`}
							/>
						</Field>
					</>
				) : (
					<>
						<Field label="URL">
							<input
								value={url}
								onChange={(event) => setUrl(event.target.value)}
								spellCheck={false}
								aria-label="URL"
								data-testid="claude-mcp-url"
								placeholder="https://example.com/mcp"
								className={FIELD_CLASS}
							/>
						</Field>
						<Field label="Headers" hint="One per line, as Name: value.">
							<textarea
								value={headers}
								onChange={(event) => setHeaders(event.target.value)}
								rows={3}
								spellCheck={false}
								aria-label="Headers"
								data-testid="claude-mcp-headers"
								placeholder="Authorization: Bearer …"
								className={`resize-y ${FIELD_CLASS}`}
							/>
						</Field>
					</>
				)}

				<Field label="Environment" hint="One per line, as KEY=value.">
					<textarea
						value={env}
						onChange={(event) => setEnv(event.target.value)}
						rows={2}
						spellCheck={false}
						aria-label="Environment"
						data-testid="claude-mcp-env"
						placeholder="GIT_AUTHOR_NAME=you"
						className={`resize-y ${FIELD_CLASS}`}
					/>
				</Field>

				<p className="tr-text-metadata text-text-muted">
					A secret typed here is written to a configuration file in the scope you choose next, and
					the diff you approve will show it. Prefer an environment variable the server reads for
					itself.
				</p>

				<ComposeActions
					testid="claude-mcp"
					problem={problem}
					onCancel={onClose}
					onSubmit={submit}
				/>
			</DialogContent>
		</Dialog>
	);
}
