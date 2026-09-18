import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import { type CodexAccount, CodexUsageWindowSchema } from "../contracts";
import { codexExecutable, createAppServer } from "./appServer";

const AccountResponse = Type.Object({
	account: Type.Union([
		Type.Null(),
		Type.Object({
			type: Type.String(),
			email: Type.Optional(Type.Union([Type.String(), Type.Null()])),
			planType: Type.Optional(Type.String()),
		}),
	]),
	requiresOpenaiAuth: Type.Boolean(),
});
const Window = Type.Omit(CodexUsageWindowSchema, ["id", "label"]);
const Bucket = Type.Object({
	limitId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	limitName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	primary: Type.Union([Window, Type.Null()]),
	secondary: Type.Union([Window, Type.Null()]),
});
const LimitsResponse = Type.Object({
	rateLimits: Bucket,
	rateLimitsByLimitId: Type.Optional(Type.Union([Type.Record(Type.String(), Bucket), Type.Null()])),
});

const execFileAsync = promisify(execFile);

async function readVersion(executable: string, timeoutMs: number): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync(executable, ["--version"], { timeout: timeoutMs });
		return stdout.trim().split(/\s+/).pop() || undefined;
	} catch {
		return undefined;
	}
}

function usageOf(limits: Static<typeof LimitsResponse>): CodexAccount["usage"] {
	const buckets = limits.rateLimitsByLimitId ?? {
		[limits.rateLimits.limitId ?? "codex"]: limits.rateLimits,
	};
	return Object.entries(buckets).flatMap(([id, bucket]) =>
		(["primary", "secondary"] as const).flatMap((kind) => {
			const window = bucket[kind];
			return window ? [{ ...window, id: `${id}:${kind}`, label: bucket.limitName ?? id }] : [];
		}),
	);
}

export function createAccountReader(command: () => string, timeoutMs = 15_000) {
	let server: ReturnType<typeof createAppServer> | null = null;
	let inFlight: Promise<CodexAccount> | null = null;
	let stopped = false;

	async function read(): Promise<CodexAccount> {
		if (!server?.alive) {
			await server?.stop();
			if (stopped) throw new Error("Codex account reader stopped.");
			server = createAppServer(codexExecutable(command()), timeoutMs);
		}
		const connection = server;
		const version = await readVersion(codexExecutable(command()), timeoutMs);
		const response = await connection.request("account/read", { refreshToken: false });
		if (!Value.Check(AccountResponse, response)) {
			await connection.stop();
			throw new Error("Invalid Codex account response.");
		}
		const account = response.account;
		const result: CodexAccount = {
			loggedIn: account !== null,
			requiresOpenaiAuth: response.requiresOpenaiAuth,
			...(version ? { version } : {}),
			...(account ? { authMethod: account.type } : {}),
			...(account?.email ? { email: account.email } : {}),
			...(account?.planType ? { plan: account.planType } : {}),
			usage: [],
		};
		if (account?.type !== "chatgpt") return result;
		try {
			const limits = await connection.request("account/rateLimits/read");
			if (!Value.Check(LimitsResponse, limits)) {
				await connection.stop();
				throw new Error("Invalid Codex rate-limits response.");
			}
			return { ...result, usage: usageOf(limits), usageFetchedAt: new Date().toISOString() };
		} catch (error) {
			return { ...result, usageError: error instanceof Error ? error.message : String(error) };
		}
	}

	return {
		read(): Promise<CodexAccount> {
			if (stopped) return Promise.reject(new Error("Codex account reader stopped."));
			inFlight ??= read().finally(() => {
				inFlight = null;
			});
			return inFlight;
		},
		stop() {
			stopped = true;
			return server?.stop();
		},
	};
}
