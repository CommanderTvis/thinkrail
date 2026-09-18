import { statSync } from "node:fs";
import { join } from "node:path";
import { type CodexLaunchOptions, codexLaunchLine } from "../launch";
import { codexHome } from "./config";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALUE_OPTIONS = new Set([
	"-c",
	"--config",
	"-m",
	"--model",
	"-p",
	"--profile",
	"-s",
	"--sandbox",
	"-a",
	"--ask-for-approval",
	"-C",
	"--cd",
	"--add-dir",
	"--enable",
	"--disable",
	"--local-provider",
	"--remote",
	"--remote-auth-token-env",
]);
const SWITCHES = new Set([
	"--oss",
	"--search",
	"--no-alt-screen",
	"--approve-for-me",
	"--yolo",
	"--dangerously-bypass-approvals-and-sandbox",
	"--dangerously-bypass-hook-trust",
	"--strict-config",
	"--include-non-interactive",
]);

export function sessionExists(sessionId: string, home = codexHome()): boolean {
	if (!UUID.test(sessionId)) return false;
	try {
		for (const path of new Bun.Glob(`**/rollout-*-${sessionId}.jsonl`).scanSync({
			cwd: join(home, "sessions"),
			absolute: true,
			onlyFiles: true,
		})) {
			if (statSync(path).size > 0) return true;
		}
	} catch {
		return false;
	}
	return false;
}

function invocation(command: string): string | null {
	const tokens: string[] = [];
	const word = /(?:[^\s"'\\;|&<>`$()]|\\.|"(?:[^"\\]|\\.)*"|'[^']*')+/y;
	let offset = 0;
	while (offset < command.length) {
		if (/\s/.test(command[offset] ?? "")) {
			offset++;
			continue;
		}
		word.lastIndex = offset;
		const match = word.exec(command);
		if (!match) return null;
		tokens.push(match[0]);
		offset = word.lastIndex;
	}
	const executable = tokens[0];
	if (!executable || executable.startsWith("-") || /^\w+=/.test(executable)) return null;
	const kept = [executable];
	for (let index = 1; index < tokens.length; index++) {
		const token = tokens[index];
		if (!token || token === "--") break;
		if (!token.startsWith("-")) continue;
		if (token === "--last" || token === "--all" || token === "--worktree") continue;
		if (token === "-i" || token === "--image") {
			index++;
			continue;
		}
		if (token.startsWith("--image=")) continue;
		const key = token.split("=", 1)[0] ?? token;
		if (SWITCHES.has(token)) kept.push(token);
		else if (VALUE_OPTIONS.has(key)) {
			const equals = token.indexOf("=");
			const value = equals < 0 ? tokens[++index] : token.slice(equals + 1);
			if (!value || value.startsWith("-")) return null;
			if ((key === "-c" || key === "--config") && /^['"]?mcp_servers\.thinkrail\.url=/.test(value))
				continue;
			kept.push(token);
			if (equals < 0) kept.push(value);
		} else return null;
	}
	return kept.join(" ");
}

export function reviveCommand(
	command: string,
	sessionId: string | undefined,
	options: Pick<CodexLaunchOptions, "mcp" | "windows" | "permissionMode">,
	home = codexHome(),
): string | null {
	const base = invocation(command);
	if (!base) return null;
	return codexLaunchLine(base, {
		...options,
		resume: sessionId && sessionExists(sessionId, home) ? { sessionId } : {},
	});
}
