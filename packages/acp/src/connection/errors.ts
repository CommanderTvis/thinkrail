import type { AgentExit, AgentLaunchSpec } from "./types";

const AUTH_REQUIRED_CODE = -32000;

const AUTH_REQUIRED_TEXT = /auth[\s_-]?required|authentication required/i;

export interface RequestErrorInfo {
	code: number | undefined;
	message: string;
	data: unknown;
	authRequired: boolean;
}

export function describeRequestError(error: unknown): RequestErrorInfo {
	if (typeof error === "string") {
		return { code: undefined, message: error, data: undefined, authRequired: false };
	}
	if (typeof error !== "object" || error === null) {
		return {
			code: undefined,
			message: "The agent failed to answer.",
			data: undefined,
			authRequired: false,
		};
	}
	const code = "code" in error && typeof error.code === "number" ? error.code : undefined;
	const text =
		"message" in error && typeof error.message === "string" && error.message.length > 0
			? error.message
			: undefined;
	const message = text ?? "The agent failed to answer.";
	return {
		code,
		message,
		data: "data" in error ? error.data : undefined,
		authRequired:
			code === AUTH_REQUIRED_CODE || (code === undefined && AUTH_REQUIRED_TEXT.test(message)),
	};
}

export type AcpSpawnReason = "not-found" | "not-executable" | "failed";

const NOT_FOUND_TEXT = /enoent|not found|no such file/i;
const NOT_EXECUTABLE_TEXT = /eacces|eperm|permission denied|not executable|is a directory/i;

export function spawnReason(error: unknown): AcpSpawnReason {
	const code =
		typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
	if (code === "ENOENT") return "not-found";
	if (code === "EACCES" || code === "EPERM" || code === "EISDIR") return "not-executable";
	const message = error instanceof Error ? error.message : String(error);
	if (NOT_FOUND_TEXT.test(message)) return "not-found";
	if (NOT_EXECUTABLE_TEXT.test(message)) return "not-executable";
	return "failed";
}

export class AcpSpawnError extends Error {
	readonly reason: AcpSpawnReason;
	readonly command: string;

	constructor(reason: AcpSpawnReason, launch: AgentLaunchSpec, cause?: unknown) {
		super(spawnMessage(reason, launch.command), cause === undefined ? undefined : { cause });
		this.name = "AcpSpawnError";
		this.reason = reason;
		this.command = launch.command;
	}
}

function spawnMessage(reason: AcpSpawnReason, command: string): string {
	switch (reason) {
		case "not-found":
			return `The agent binary ${command} was not found.`;
		case "not-executable":
			return `The agent binary ${command} is not executable.`;
		case "failed":
			return `The agent binary ${command} could not be started.`;
	}
}

export class AcpVersionError extends Error {
	readonly expected: number;
	readonly received: number;

	constructor(expected: number, received: number) {
		super(`The agent speaks ACP version ${received}; ThinkRail speaks ${expected}.`);
		this.name = "AcpVersionError";
		this.expected = expected;
		this.received = received;
	}
}

export class AcpAuthRequiredError extends Error {
	readonly detail: string;

	constructor(detail: string) {
		super(detail);
		this.name = "AcpAuthRequiredError";
		this.detail = detail;
	}
}

export class AcpConnectionClosedError extends Error {
	readonly exit: AgentExit | null;

	constructor(exit: AgentExit | null, reason?: string) {
		super(closedMessage(exit, reason));
		this.name = "AcpConnectionClosedError";
		this.exit = exit;
	}
}

function closedMessage(exit: AgentExit | null, reason: string | undefined): string {
	const head =
		reason !== undefined && reason.length > 0
			? `The agent connection closed: ${reason}`
			: "The agent connection closed.";
	if (exit === null) return head;
	const how =
		exit.signal !== null
			? ` The process was killed by ${exit.signal}.`
			: exit.code !== null
				? ` The process exited with code ${exit.code}.`
				: "";
	const tail = exit.stderrTail.length > 0 ? exit.stderrTail : exit.stdoutNoise;
	return tail.length > 0 ? `${head}${how}\n${tail}` : `${head}${how}`;
}
