import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import type { CodexModel } from "../contracts";
import { codexExecutable, createAppServer } from "./appServer";

const Response = Type.Object({
	data: Type.Array(
		Type.Object({
			model: Type.String(),
			displayName: Type.Optional(Type.String()),
		}),
	),
	nextCursor: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

function modelsOf(response: Static<typeof Response>): CodexModel[] {
	return response.data.map((model) => ({
		id: model.model,
		label: model.displayName ?? model.model,
	}));
}

export function createModelReader(command: () => string, timeoutMs = 15_000) {
	let server: ReturnType<typeof createAppServer> | null = null;
	let cached: CodexModel[] | null = null;
	let inFlight: Promise<CodexModel[]> | null = null;
	let stopped = false;

	async function read(): Promise<CodexModel[]> {
		if (!server?.alive) {
			await server?.stop();
			if (stopped) throw new Error("Codex model reader stopped.");
			server = createAppServer(codexExecutable(command()), timeoutMs);
		}
		const models: CodexModel[] = [];
		let cursor: string | null | undefined;
		do {
			const response = await server.request("model/list", {
				cursor,
				includeHidden: false,
				limit: 100,
			});
			if (!Value.Check(Response, response)) throw new Error("Invalid Codex model catalog.");
			models.push(...modelsOf(response));
			cursor = response.nextCursor;
		} while (cursor);
		return models;
	}

	return {
		read(): Promise<CodexModel[]> {
			if (stopped) return Promise.reject(new Error("Codex model reader stopped."));
			if (cached) return Promise.resolve(cached);
			inFlight ??= read()
				.then((models) => (cached = models))
				.finally(() => {
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
