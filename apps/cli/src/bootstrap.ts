import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { BuildKind } from "@thinkrail/server";
import { printStartupMark } from "@thinkrail/shared/startupMark";
import { channel, version } from "@thinkrail/shared/version";
import { bundledAgentLaunch, runBundledAgent } from "./acpPi";
import { type CliOptions, parseArgs, parseSubcommand, type Subcommand, USAGE } from "./args";

const DEFAULT_STATIC_DIR = resolve(import.meta.dir, "../../web/dist");

function openBrowser(url: string): void {
	const command =
		process.platform === "darwin"
			? ["open", url]
			: process.platform === "win32"
				? ["cmd", "/c", "start", "", url]
				: ["xdg-open", url];
	try {
		Bun.spawn(command, { stdout: "ignore", stderr: "ignore" }).unref();
	} catch {}
}

async function runSubcommand(subcommand: Subcommand, argv: readonly string[]): Promise<number> {
	const rest = argv.slice(1);
	switch (subcommand) {
		case "acp-pi":
			return runBundledAgent();
		case "agent": {
			const { runAgentCommand } = await import("./agents");
			return runAgentCommand(rest);
		}
		case "update": {
			const { runUpdate } = await import("./update");
			return runUpdate(rest, process.env);
		}
		case "uninstall": {
			const { runUninstall } = await import("./uninstall");
			return runUninstall(rest, process.env);
		}
	}
}

async function bootstrap(build: BuildKind): Promise<void> {
	const argv = Bun.argv.slice(2);
	const subcommand = parseSubcommand(argv);
	if (subcommand) process.exit(await runSubcommand(subcommand, argv));

	let options: CliOptions;
	try {
		options = parseArgs(argv, process.env);
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		console.error(`\n${USAGE}`);
		process.exit(1);
	}

	if (options.help) {
		console.log(USAGE);
		return;
	}

	if (options.version) {
		console.log(version);
		return;
	}

	const staticDir = options.staticDir ?? DEFAULT_STATIC_DIR;
	if (!existsSync(staticDir)) {
		console.warn(`Web app not found at ${staticDir} — run \`bun run build:web\` to build the UI.`);
	}

	const { bootHost, setBundledAgentLaunch } = await import("@thinkrail/server");
	setBundledAgentLaunch(bundledAgentLaunch(build));

	const { port, requested } = await bootHost({
		port: options.port,
		host: options.host,
		portMode: "free",
		staticDir,
		appVersion: version,
		...(options.verbose ? { verbose: true } : {}),
		analytics: {
			channel,
			build,
			mute: options.noAnalytics,
		},
		...(options.projectDir ? { projectPath: resolve(process.cwd(), options.projectDir) } : {}),
	});
	if (port !== requested) {
		console.warn(`Port ${requested} is in use; using free port ${port}.`);
	}

	const openHost = options.host === "0.0.0.0" || options.host === "::" ? "localhost" : options.host;
	const url = `http://${openHost}:${port}`;
	printStartupMark({ status: "host ready", endpoint: url });
	console.log(`thinkrail → ${url}`);
	if (options.open) openBrowser(url);
}

export async function launch(build: BuildKind): Promise<void> {
	try {
		await bootstrap(build);
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
}
