import { type AgentCatalogEntry, forgetAgent, readAgentCatalog, recordAgent } from "@thinkrail/acp";
import { agentsDir, BUNDLED_AGENT_ID } from "@thinkrail/server";
import { AGENT_USAGE, type AgentCommand, parseAgentArgs } from "./args";

function describe(entry: AgentCatalogEntry): string {
	return `${entry.id}  ${entry.name}  ${[entry.launch.command, ...entry.launch.args].join(" ")}`;
}

export async function runAgentCommand(argv: readonly string[]): Promise<number> {
	let command: AgentCommand;
	try {
		command = parseAgentArgs(argv);
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		console.error(`\n${AGENT_USAGE}`);
		return 1;
	}

	const dir = agentsDir();
	switch (command.kind) {
		case "help":
			console.log(AGENT_USAGE);
			return 0;
		case "list": {
			for (const entry of await readAgentCatalog(dir)) console.log(describe(entry));
			console.log(`${BUNDLED_AGENT_ID}  ThinkRail pi  (bundled — the default)`);
			return 0;
		}
		case "add": {
			if (command.entry.id === BUNDLED_AGENT_ID) {
				console.error(`"${BUNDLED_AGENT_ID}" is the bundled agent's id — pick another.`);
				return 1;
			}
			await recordAgent(dir, command.entry);
			console.log(`Registered ${describe(command.entry)}`);
			return 0;
		}
		case "remove": {
			const registered = await readAgentCatalog(dir);
			if (!registered.some((entry) => entry.id === command.agentId)) {
				console.error(`No agent named "${command.agentId}" is registered.`);
				return 1;
			}
			await forgetAgent(dir, command.agentId);
			console.log(`Removed ${command.agentId}.`);
			return 0;
		}
	}
}
