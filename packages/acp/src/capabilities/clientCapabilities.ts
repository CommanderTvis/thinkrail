import type { ClientCapabilities, Implementation } from "@agentclientprotocol/sdk";
import { THINKRAIL_EXTENSION_IDS, writeThinkRailMeta } from "../meta";

export const THINKRAIL_CLIENT_CAPABILITIES: ClientCapabilities = {
	fs: { readTextFile: true, writeTextFile: true },
	terminal: true,
	session: { configOptions: { boolean: {} } },
	plan: {},
	auth: { terminal: true },
	elicitation: { form: {}, url: {} },
	_meta: writeThinkRailMeta({ extensions: [...THINKRAIL_EXTENSION_IDS] }),
};

export const THINKRAIL_CLIENT_INFO: Implementation = {
	name: "thinkrail",
	title: "ThinkRail",
	version: "0.0.0",
};
