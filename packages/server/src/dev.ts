import { resolveShellEnv } from "@thinkrail/shared/shellEnv";
import { setBundledAgentLaunch } from "./agent";
import { bootHost } from "./host";

resolveShellEnv();

const bundledAgentCommand = process.env.THINKRAIL_BUNDLED_AGENT_COMMAND;
if (bundledAgentCommand !== undefined) {
	const [command, ...args] = bundledAgentCommand.split(" ").filter(Boolean);
	if (command !== undefined) setBundledAgentLaunch({ command, args });
}

const host = process.env.THINKRAIL_HOST ?? "localhost";
const staticDir = process.env.THINKRAIL_STATIC_DIR;
const envPort = process.env.THINKRAIL_PORT;

const { port } = await bootHost({
	port: envPort ? Number(envPort) : 24242,
	host,
	portMode: envPort ? "exact" : "free",
	...(staticDir ? { staticDir } : {}),
	analytics: { channel: "dev", build: "source" },
});
console.log(`thinkrail host: http://${host}:${port}`);
