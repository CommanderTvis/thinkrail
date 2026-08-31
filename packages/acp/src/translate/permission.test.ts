import { expect, test } from "bun:test";
import type {
	PermissionOption as AcpPermissionOption,
	RequestPermissionRequest,
} from "@agentclientprotocol/sdk";
import { toPermissionOptions, toPermissionOutcome, toPermissionRequest } from "./permission";

function options(payload: unknown): ReturnType<typeof toPermissionOptions> {
	return toPermissionOptions(payload as readonly AcpPermissionOption[]);
}

function request(payload: unknown): ReturnType<typeof toPermissionRequest> {
	return toPermissionRequest(payload as RequestPermissionRequest, "p1");
}

test("the four option kinds map onto the button tones", () => {
	expect(
		options([
			{ optionId: "a", name: "Allow", kind: "allow_once" },
			{ optionId: "b", name: "Always allow", kind: "allow_always" },
			{ optionId: "c", name: "Reject", kind: "reject_once" },
			{ optionId: "d", name: "Always reject", kind: "reject_always" },
		]).map((option) => option.kind),
	).toEqual(["allowOnce", "allowAlways", "rejectOnce", "rejectAlways"]);
});

test("an unrecognised kind fails closed rather than rendering as an allow", () => {
	expect(options([{ optionId: "a", name: "Allow for this file", kind: "allow_for_path" }])).toEqual(
		[{ id: "a", name: "Allow for this file", kind: "rejectOnce" }],
	);
});

test("an option with no id is dropped and one with no name is labelled by its id", () => {
	expect(
		options([
			{ name: "Allow", kind: "allow_once" },
			{ optionId: "b", kind: "allow_once" },
		]),
	).toEqual([{ id: "b", name: "b", kind: "allowOnce" }]);
});

test("the prompt carries the minted id and a card built from the call the agent named", () => {
	const prompt = request({
		sessionId: "s1",
		toolCall: {
			toolCallId: "t1",
			title: "Run ls",
			name: "bash",
			kind: "execute",
			rawInput: { command: "ls" },
		},
		options: [{ optionId: "a", name: "Allow", kind: "allow_once" }],
	});

	expect(prompt.id).toBe("p1");
	expect(prompt.sessionId).toBe("s1");
	expect(prompt.toolCallId).toBe("t1");
	expect(prompt.call).toEqual({
		type: "toolCall",
		toolCallId: "t1",
		toolName: "bash",
		title: "Run ls",
		kind: "execute",
		status: "running",
		arguments: { command: "ls" },
	});
});

test("a nameless call still renders, under a name no built-in renderer claims", () => {
	const prompt = request({
		sessionId: "s1",
		toolCall: { toolCallId: "t2", kind: "edit" },
		options: [],
	});
	expect(prompt.call.toolName).toBe("acp:edit");
	expect(prompt.call.title).toBe("t2");
	expect(prompt.options).toEqual([]);
});

test("the user's answer maps onto the outcome the agent is waiting on", () => {
	expect(toPermissionOutcome({ id: "p1", outcome: "selected", optionId: "a" })).toEqual({
		outcome: "selected",
		optionId: "a",
	});
	expect(toPermissionOutcome({ id: "p1", outcome: "cancelled" })).toEqual({ outcome: "cancelled" });
});
