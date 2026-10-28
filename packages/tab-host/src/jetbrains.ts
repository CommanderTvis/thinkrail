import {
	createProvider,
	type FetchFunction,
	type Model,
	type OAuthAuth,
	type OAuthCredential,
	type Provider,
	type ProviderStreams,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";

export const JETBRAINS_AI_PROVIDER_ID = "jetbrains-ai";

const OAUTH_TOKEN_URL = "https://oauth.account.jetbrains.com/oauth2/token";
const OAUTH_CLIENT_ID = "central-cli";
const GRAZIE_BASE_URL = "https://api.jetbrains.ai";
const LICENSE_JWT_URL = `${GRAZIE_BASE_URL}/auth/jetbrains-jwt/provide-access/license/v2`;
const JWT_HEADER = "grazie-authenticate-jwt";
const SESSION_MS = 60 * 60_000;

const LICENSE_ID_SHAPE = /^[A-Za-z0-9-]+$/;

const DISCLAIMER =
	"This is an unofficial fork of ThinkRail, not affiliated with or endorsed by JetBrains; the fork's author takes no responsibility for what happens to your account, licence or tokens. It signs in with Central's login outside Central and talks to JetBrains AI from a client JetBrains did not make: JetBrains may treat that as a breach of its terms and could suspend your account or licence. You use it at your own risk.";

export const tokenCommand = (licenseId: string): string =>
	[
		`central login && LICENSE_ID=${licenseId} &&`,
		"curl -s https://api.jetbrains.ai/auth/jetbrains-jwt/provide-access/license/v2",
		'-H "Authorization: Bearer $(curl -s https://oauth.account.jetbrains.com/oauth2/token',
		"-d grant_type=refresh_token -d client_id=central-cli",
		`-d refresh_token="$(central login export | jq -rR 'ltrimstr("central-")|gsub("-";"+")|gsub("_";"/")|@base64d|fromjson|.refresh_token')"`,
		'| jq -r .id_token)"',
		"-H 'Content-Type: application/json'",
		'-d "{\\"licenseId\\":\\"$LICENSE_ID\\"}" | jq -r .token',
	].join(" ");

interface ExportedSession {
	refreshToken: string;
}

export function parseCentralExport(exported: string): ExportedSession {
	const body = exported.trim().replace(/^central-/, "");
	let envelope: Record<string, unknown>;
	try {
		envelope = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/")));
	} catch {
		throw new Error("That is not the output of `central login export`.");
	}
	const refreshToken = envelope.refresh_token;
	if (typeof refreshToken !== "string" || refreshToken === "")
		throw new Error("The exported Central session has no refresh token.");
	return { refreshToken };
}

function isJwt(value: string): boolean {
	return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(value);
}

function sessionEnd(jwt: string): number {
	return Math.min(jwtExpiry(jwt), Date.now() + SESSION_MS);
}

function jwtExpiry(jwt: string): number {
	const payload = JSON.parse(atob(jwt.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/") ?? ""));
	return payload.exp * 1000;
}

async function postJson(
	fetchImpl: FetchFunction,
	url: string,
	init: RequestInit,
	signal: AbortSignal,
): Promise<Record<string, unknown>> {
	const response = await fetchImpl(url, { ...init, signal });
	if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
	return response.json();
}

async function mintJwt(
	fetchImpl: FetchFunction,
	refreshToken: string,
	licenseId: string,
	signal: AbortSignal,
): Promise<{ jwt: string; expires: number }> {
	const tokens = await postJson(
		fetchImpl,
		OAUTH_TOKEN_URL,
		{
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "refresh_token",
				client_id: OAUTH_CLIENT_ID,
				refresh_token: refreshToken,
			}),
		},
		signal,
	).catch(() => {
		throw new Error("JetBrains rejected the Central session. Run `central login export` again.");
	});
	const idToken = tokens.id_token;
	if (typeof idToken !== "string")
		throw new Error("JetBrains returned no id token for this session.");
	const granted = await postJson(
		fetchImpl,
		LICENSE_JWT_URL,
		{
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${idToken}` },
			body: JSON.stringify({ licenseId }),
		},
		signal,
	).catch(() => {
		throw new Error(`JetBrains AI refused licence ${licenseId} for this account.`);
	});
	const jwt = granted.token;
	if (typeof jwt !== "string")
		throw new Error(`JetBrains AI issued no token for licence ${licenseId}.`);
	return { jwt, expires: sessionEnd(jwt) };
}

function oauth(fetchImpl: FetchFunction): OAuthAuth {
	return {
		name: "JetBrains AI (Central session)",
		isSubscription: true,
		loginLabel: "Sign in with a Central session",
		async login(interaction) {
			const licenseId = (
				await interaction.prompt({
					type: "text",
					message: [
						"Your JetBrains AI licence ID, from account.jetbrains.com/licenses.",
						DISCLAIMER,
					].join("\n\n"),
					placeholder: "licence ID",
				})
			).trim();
			if (!LICENSE_ID_SHAPE.test(licenseId)) throw new Error("That is not a licence ID.");
			const pasted = (
				await interaction.prompt({
					type: "secret",
					message: [
						"Run this in a terminal (needs Central, curl and jq) and paste the token it prints. A hosted page cannot sign in to JetBrains itself; where it can, such as localhost, the output of `central login export` works too. Nothing is kept beyond an hour.",
						`$ ${tokenCommand(licenseId)}`,
						DISCLAIMER,
					].join("\n\n"),
					placeholder: "token",
				})
			).trim();
			if (isJwt(pasted))
				return { type: "oauth", refresh: "", access: pasted, expires: sessionEnd(pasted) };
			interaction.notify({ type: "progress", message: "Asking JetBrains AI for access…" });
			const { jwt, expires } = await mintJwt(
				fetchImpl,
				parseCentralExport(pasted).refreshToken,
				licenseId,
				interaction.signal,
			);
			return { type: "oauth", refresh: "", access: jwt, expires };
		},
		async refresh() {
			throw new Error(
				"The JetBrains AI hour is over. Disconnect and connect again with a new token.",
			);
		},
		async toAuth(credential: OAuthCredential) {
			return { apiKey: credential.access };
		},
	};
}

/** Grazie's preflight allows only Content-Type, Authorization and Grazie-* headers; the SDK adds more. */
export function grazieFetch(fetchImpl: FetchFunction): FetchFunction {
	return asFetch((input, init) => {
		const original = new Headers(init?.headers);
		const jwt =
			original.get("x-api-key") ?? original.get("authorization")?.replace(/^Bearer /i, "");
		const headers = new Headers();
		const contentType = original.get("content-type");
		if (contentType) headers.set("content-type", contentType);
		if (jwt) headers.set(JWT_HEADER, jwt);
		const body = withoutUnsupportedFields(init?.body);
		return fetchImpl(input, { ...init, headers, ...(body == null ? {} : { body }) });
	});
}

function withoutUnsupportedFields(body: RequestInit["body"]): RequestInit["body"] {
	if (typeof body !== "string") return body;
	try {
		const { output_config: _outputConfig, messages, thinking, ...rest } = JSON.parse(body);
		const { block_binding: _blockBinding, ...plainThinking } = thinking ?? {};
		return JSON.stringify({
			...rest,
			...(thinking ? { thinking: plainThinking } : {}),
			messages: Array.isArray(messages)
				? messages.filter((message) => !("output_config" in message))
				: messages,
		});
	} catch {
		return body;
	}
}

function asFetch(
	call: (input: Parameters<FetchFunction>[0], init?: RequestInit) => Promise<Response>,
): FetchFunction {
	return Object.assign(call, { preconnect: () => {} });
}

function withGrazieFetch(streams: ProviderStreams, fetchImpl: FetchFunction): ProviderStreams {
	const wrapped = grazieFetch(fetchImpl);
	return {
		stream: (model, context, options) =>
			streams.stream(model, context, { ...options, fetch: wrapped }),
		streamSimple: (model, context, options) =>
			streams.streamSimple(model, context, { ...options, fetch: wrapped }),
	};
}

/** JetBrains AI through Grazie, which is open to browser origins. Models are Claude's, served at Grazie's Anthropic route. */
export function jetbrainsAiProvider(
	claudeModels: readonly Model<"anthropic-messages">[],
	fetchImpl: FetchFunction = asFetch((input, init) => fetch(input, init)),
): Provider {
	const baseUrl = `${GRAZIE_BASE_URL}/user/v5/llm/anthropic`;
	return createProvider({
		id: JETBRAINS_AI_PROVIDER_ID,
		name: "JetBrains AI",
		baseUrl,
		auth: { oauth: oauth(fetchImpl) },
		models: claudeModels.map((model) => ({
			...model,
			provider: JETBRAINS_AI_PROVIDER_ID,
			baseUrl,
		})),
		api: withGrazieFetch(anthropicMessagesApi(), fetchImpl),
	});
}
