import { expect, test } from "bun:test";
import type {
	ClientRequestMethod,
	ClientRequestParamsByMethod,
	ClientRequestResponsesByMethod,
} from "@agentclientprotocol/sdk";
import type { SessionToolBinding } from "../engine";
import {
	type DelegatedClient,
	type DelegationTarget,
	delegatedBash,
	delegatedEdit,
	delegatedRead,
	delegatedWrite,
} from "./delegation";

interface Call {
	method: string;
	params: unknown;
}

type Responder = (method: string, params: unknown) => unknown;

function target(respond: Responder, binding: SessionToolBinding = { sessionId: "s1" }) {
	const calls: Call[] = [];
	const client: DelegatedClient = {
		request: <Method extends ClientRequestMethod>(
			method: Method,
			params: ClientRequestParamsByMethod[Method],
		): Promise<ClientRequestResponsesByMethod[Method]> => {
			calls.push({ method, params });
			return Promise.resolve(respond(method, params) as ClientRequestResponsesByMethod[Method]);
		},
	};
	const delegation: DelegationTarget = { client: () => client, binding };
	return { calls, delegation };
}

test("read goes out as fs/read_text_file for the bound session", async () => {
	const { calls, delegation } = target(() => ({ content: "hello\n" }));
	const buffer = await delegatedRead(delegation).readFile("/repo/a.ts");
	expect(buffer.toString("utf8")).toBe("hello\n");
	expect(calls).toEqual([
		{ method: "fs/read_text_file", params: { sessionId: "s1", path: "/repo/a.ts" } },
	]);
});

test("write goes out as fs/write_text_file, and mkdir is the client's business", async () => {
	const { calls, delegation } = target(() => ({}));
	const operations = delegatedWrite(delegation);
	await operations.mkdir("/repo/nested");
	await operations.writeFile("/repo/nested/a.ts", "body");
	expect(calls).toEqual([
		{
			method: "fs/write_text_file",
			params: { sessionId: "s1", path: "/repo/nested/a.ts", content: "body" },
		},
	]);
});

test("edit reads and writes through the same two client methods", async () => {
	const { calls, delegation } = target((method) =>
		method === "fs/read_text_file" ? { content: "before" } : {},
	);
	const operations = delegatedEdit(delegation);
	await operations.access("/repo/a.ts");
	await operations.writeFile("/repo/a.ts", "after");
	expect(calls.map((call) => call.method)).toEqual(["fs/read_text_file", "fs/write_text_file"]);
});

test("an unbound session refuses rather than silently running locally", async () => {
	const { delegation } = target(() => ({ content: "" }), { sessionId: null });
	expect(delegatedRead(delegation).readFile("/repo/a.ts")).rejects.toThrow(
		"The ThinkRail host is not attached to this session.",
	);
});

test("bash creates a client terminal, streams its output, and releases it", async () => {
	const outputs = ["part one\n", "part one\npart two\n"];
	let reads = 0;
	const { calls, delegation } = target((method) => {
		if (method === "terminal/create") return { terminalId: "term-1" };
		if (method === "terminal/output") {
			const output = outputs[Math.min(reads++, outputs.length - 1)] ?? "";
			return { output, truncated: false };
		}
		if (method === "terminal/wait_for_exit") return { exitCode: 0 };
		return {};
	});

	const chunks: string[] = [];
	const result = await delegatedBash(delegation).exec("echo hi", "/repo", {
		onData: (data) => chunks.push(data.toString("utf8")),
		env: { PATH: "/usr/bin" },
	});

	expect(result).toEqual({ exitCode: 0 });
	expect(chunks.join("")).toBe("part one\npart two\n");
	expect(calls[0]).toEqual({
		method: "terminal/create",
		params: {
			sessionId: "s1",
			command: "bash",
			args: ["-lc", "echo hi"],
			cwd: "/repo",
			env: [{ name: "PATH", value: "/usr/bin" }],
			outputByteLimit: 2_000_000,
		},
	});
	expect(calls.at(-1)).toEqual({
		method: "terminal/release",
		params: { sessionId: "s1", terminalId: "term-1" },
	});
});

test("a killed terminal reports no exit code rather than a fabricated zero", async () => {
	const { delegation } = target((method) => {
		if (method === "terminal/create") return { terminalId: "term-1" };
		if (method === "terminal/output") return { output: "", truncated: false };
		if (method === "terminal/wait_for_exit") return { signal: "SIGKILL" };
		return {};
	});
	const result = await delegatedBash(delegation).exec("sleep 100", "/repo", { onData: () => {} });
	expect(result).toEqual({ exitCode: null });
});

test("aborting the tool kills the client terminal", async () => {
	const controller = new AbortController();
	let resolveExit: (() => void) | undefined;
	const exited = new Promise<void>((resolve) => {
		resolveExit = resolve;
	});
	const { calls, delegation } = target((method) => {
		if (method === "terminal/create") return { terminalId: "term-1" };
		if (method === "terminal/output") return { output: "", truncated: false };
		if (method === "terminal/kill") {
			resolveExit?.();
			return {};
		}
		if (method === "terminal/wait_for_exit") return exited.then(() => ({ exitCode: 143 }));
		return {};
	});

	const running = delegatedBash(delegation).exec("sleep 100", "/repo", {
		onData: () => {},
		signal: controller.signal,
	});
	controller.abort();
	await running;
	expect(calls.map((call) => call.method)).toContain("terminal/kill");
});
