import { resolve } from "node:path";
import type { AgentLaunchSpec } from "@thinkrail/acp";
import type { BuildKind } from "@thinkrail/server";

const AGENT_SUBCOMMAND = "acp-pi";

export function bundledAgentLaunch(build: BuildKind): AgentLaunchSpec {
	if (build === "binary") return { command: process.execPath, args: [AGENT_SUBCOMMAND] };
	return {
		command: process.execPath,
		args: [resolve(import.meta.dir, "index.ts"), AGENT_SUBCOMMAND],
	};
}

export async function runBundledAgent(): Promise<number> {
	const { runPiAgentOnStdio } = await import("@thinkrail/pi-agent");
	await runPiAgentOnStdio();
	return 0;
}
