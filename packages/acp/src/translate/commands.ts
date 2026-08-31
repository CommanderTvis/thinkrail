import type { AvailableCommand } from "@agentclientprotocol/sdk";
import type { SlashCommand } from "@thinkrail/contracts";
import { asArray, asFilledString, asRecord } from "./guards";

export function toSlashCommands(
	commands: readonly AvailableCommand[] | null | undefined,
): SlashCommand[] {
	const out: SlashCommand[] = [];
	for (const entry of asArray(commands)) {
		const raw = asRecord(entry);
		if (raw === undefined) continue;
		const name = asFilledString(raw.name);
		if (name === undefined) continue;
		const description = asFilledString(raw.description);
		const argumentHint = asFilledString(asRecord(raw.input)?.hint);
		out.push({
			name,
			...(description !== undefined ? { description } : {}),
			...(argumentHint !== undefined ? { argumentHint } : {}),
		});
	}
	return out;
}
