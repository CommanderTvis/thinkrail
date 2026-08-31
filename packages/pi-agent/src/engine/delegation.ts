import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildSessionContext, getAgentDir, SessionManager } from "@earendil-works/pi-coding-agent";
import type { ChatBlock, ChatMessage, DelegationRunStatus } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import {
	createDelegationService,
	type DelegationService,
	deriveChildSessionFile,
} from "pi-delegation";
import { createSubagentsExtension } from "pi-subagents";
import { liveParentContext } from "./agentSessionManager";
import { type BundledExtensionFactory, childExtensionFactories } from "./extensions";
import { getPiRuntime } from "./piRuntime";

export function delegationRootDir(): string {
	return join(resolve(getAgentDir()), "delegation");
}

const services = new Map<string, DelegationService>();

export function delegationServiceFor(cwd: string): DelegationService {
	const workspaceId = delegationScope(cwd);
	let service = services.get(workspaceId);
	if (!service) {
		service = createDelegationService({
			resolveParent: liveParentContext,
			delegationRoot: delegationRootDir(),
			scope: workspaceId,
			modelRuntime: getPiRuntime,
			childExtensionFactories: childExtensionFactories(),
		});
		services.set(workspaceId, service);
	}
	return service;
}

export function subagentsExtensionFor(cwd: string): BundledExtensionFactory {
	return createSubagentsExtension({
		service: delegationServiceFor(cwd),
		delegationRoot: delegationRootDir(),
		scope: delegationScope(cwd),
	});
}

export async function disposeSessionChildren(cwd: string, parentSessionId: string): Promise<void> {
	await services.get(delegationScope(cwd))?.disposeChildrenOf(parentSessionId);
}

export function removeWorkspaceDelegation(cwd: string): void {
	const workspaceId = delegationScope(cwd);
	services.delete(workspaceId);
	rmSync(join(delegationRootDir(), workspaceId), { recursive: true, force: true });
}

export function delegationScope(cwd: string): string {
	return createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 32);
}

function assertPathSegment(value: string, label: string): void {
	if (value.length === 0 || value.includes("/") || value.includes("\\") || value.includes("..")) {
		throw new Error(`Invalid ${label}: not a plain id`);
	}
}

export function readChildTranscript(
	cwd: string,
	parentSessionId: string,
	childSessionId: string,
): { messages: ChatMessage[]; status?: DelegationRunStatus } {
	assertPathSegment(parentSessionId, "parentSessionId");
	assertPathSegment(childSessionId, "childSessionId");
	const scope = delegationScope(cwd);
	const path = deriveChildSessionFile(delegationRootDir(), scope, parentSessionId, childSessionId);
	if (!path) {
		throw new CodedError(
			"SUBAGENT_TRANSCRIPT_NOT_FOUND",
			`No transcript found for subagent session ${childSessionId}`,
		);
	}
	const sessionManager = SessionManager.open(path);
	const messages = toChatMessages(
		buildSessionContext(sessionManager.getEntries()).messages,
		childSessionId,
	);
	const status = services.get(scope)?.findChild(childSessionId)?.snapshot?.status;
	return { messages, ...(status !== undefined ? { status } : {}) };
}

type PiTranscriptMessage = {
	role: string;
	content?: unknown;
	timestamp?: number;
};

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(part): part is { type: "text"; text: string } =>
				!!part && typeof part === "object" && (part as { type?: unknown }).type === "text",
		)
		.map((part) => part.text)
		.join("");
}

function toChatMessages(messages: readonly unknown[], childSessionId: string): ChatMessage[] {
	const out: ChatMessage[] = [];
	for (const [index, raw] of messages.entries()) {
		const message = raw as PiTranscriptMessage;
		const text = textOf(message.content);
		if (text.length === 0) continue;
		const id = `${childSessionId}:${index}`;
		const timestamp = typeof message.timestamp === "number" ? message.timestamp : 0;
		if (message.role === "user") {
			out.push({ role: "user", id, timestamp, content: [{ type: "text", text }] });
			continue;
		}
		if (message.role !== "assistant") continue;
		const blocks: ChatBlock[] = [{ type: "text", text }];
		out.push({ role: "assistant", id, timestamp, blocks, endedAt: timestamp });
	}
	return out;
}
