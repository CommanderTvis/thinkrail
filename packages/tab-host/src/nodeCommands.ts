import { defineCommand, type ExecResult } from "just-bash/browser";
import { joinPath, normalizePath, type TabFs } from "./fs";
import { runNodeIsolated } from "./node";
import { binsUnder, DEFAULT_REGISTRY, type Manifest, NpmInstaller, parseSpec } from "./npm";

const NPX_CACHE = "/tmp/npx";
const TSC_PACKAGE = "typescript@5";
const NPM_VERSION = "10.9.0";

const NPM_USAGE = [
	"npm in the ThinkRail Playground (registry packages only; install scripts never run):",
	"  npm install|i|add [-D] [--dry-run] [<pkg>[@<range>]…]   npm ci",
	"  npm uninstall|rm <pkg>…   npm run [<script>]   npm test   npm ls   npm init -y   npm -v",
].join("\n");
const NPX_USAGE =
	"npx [-y] [-p <pkg>] <command> [args…]: runs a bin from node_modules, or fetches the package first.";

export const NODE_RISK_NOTICE = [
	"⚠ node, npm and npx here run third-party code inside this browser tab.",
	"  It runs in a separate worker on a copy of this project, without your API keys, but it can still",
	"  change or delete the project's files and reach the network. npm never runs install scripts, packages",
	"  with native addons won't work, and node is an emulation: no child processes, servers or sockets.",
].join("\n");

const ok = (stdout: string, stderr = ""): ExecResult => ({ stdout, stderr, exitCode: 0 });
const fail = (stderr: string, exitCode = 1): ExecResult => ({ stdout: "", stderr, exitCode });

function projectRoot(fs: TabFs, cwd: string, fallback: string): string {
	for (let dir = normalizePath(cwd); ; dir = joinPath(dir, "..")) {
		if (fs.existsSync(joinPath(dir, "package.json"))) return dir;
		if (dir === "/" || dir === fallback) return fallback;
	}
}

function readJson(fs: TabFs, file: string): Record<string, unknown> {
	return JSON.parse(fs.readFileSync(file, "utf8") as string) as Record<string, unknown>;
}

/**
 * `node`, `npm`, `npx` and `tsc` for the tab's shell. Each shell prints {@link NODE_RISK_NOTICE} the first
 * time one of them runs, so whoever reads the output, a person or the agent's transcript, sees it.
 */
export function nodeCommands(fs: TabFs, workspaceRoot: string) {
	let warned = false;
	const notice = () => {
		if (warned) return "";
		warned = true;
		return `${NODE_RISK_NOTICE}\n`;
	};
	const withNotice = (result: ExecResult): ExecResult => ({
		...result,
		stderr: notice() + result.stderr,
	});
	const envOf = (ctx: { env: Map<string, string> }) => Object.fromEntries(ctx.env);

	const runEntry = async (
		ctx: { cwd: string; env: Map<string, string>; stdin: unknown },
		entry: string,
		args: string[],
		extraRoots: string[] = [],
	): Promise<ExecResult> => {
		const root = projectRoot(fs, ctx.cwd, workspaceRoot);
		const result = await runNodeIsolated(fs, {
			roots: [workspaceRoot, ...(root === workspaceRoot ? [] : [root]), ...extraRoots],
			cwd: ctx.cwd,
			env: envOf(ctx),
			entry,
			args,
		});
		return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
	};

	const node = defineCommand("node", async (args, ctx) => {
		if (args[0] === "-v" || args[0] === "--version") return ok("v22.12.0\n");
		const evalIndex = args.findIndex(
			(arg) => arg === "-e" || arg === "--eval" || arg === "-p" || arg === "--print",
		);
		if (evalIndex >= 0) {
			const code = args[evalIndex + 1];
			if (code === undefined) return fail(`node: ${args[evalIndex]} requires an argument\n`, 9);
			const result = await runNodeIsolated(fs, {
				roots: [workspaceRoot],
				cwd: ctx.cwd,
				env: envOf(ctx),
				code,
				print: args[evalIndex] === "-p" || args[evalIndex] === "--print",
				args: args.slice(evalIndex + 2),
			});
			return withNotice({
				stdout: result.stdout,
				stderr: result.stderr,
				exitCode: result.exitCode,
			});
		}
		const scriptIndex = args.findIndex((arg) => !arg.startsWith("-"));
		const script = args[scriptIndex];
		if (!script)
			return fail(
				"node: the interactive REPL is not available in the Playground; pass a script or -e\n",
			);
		return withNotice(await runEntry(ctx, script, args.slice(scriptIndex + 1)));
	});

	let registry: string | undefined;
	const installer = (log: string[]) =>
		new NpmInstaller(fs, (line) => log.push(line), registry ?? DEFAULT_REGISTRY);

	const npmInstall = async (
		cwd: string,
		specs: string[],
		dev: boolean,
		dryRun: boolean,
	): Promise<ExecResult> => {
		const root = projectRoot(fs, cwd, workspaceRoot);
		const manifestFile = joinPath(root, "package.json");
		const manifest = fs.existsSync(manifestFile) ? readJson(fs, manifestFile) : {};
		const log: string[] = [];
		const started = performance.now();
		let installed: Manifest[];
		if (specs.length === 0) {
			const wanted = {
				...((manifest.dependencies as Record<string, string>) ?? {}),
				...((manifest.devDependencies as Record<string, string>) ?? {}),
			};
			installed = await installer(log).install(root, wanted, { dryRun });
		} else if (dryRun) {
			const wanted = Object.fromEntries(specs.map((spec) => Object.values(parseSpec(spec))));
			installed = await installer(log).install(root, wanted, { dryRun });
		} else {
			const wanted = Object.fromEntries(specs.map((spec) => Object.values(parseSpec(spec))));
			installed = await installer(log).install(root, wanted);
			const field = dev ? "devDependencies" : "dependencies";
			const section = { ...((manifest[field] as Record<string, string>) ?? {}) };
			for (const spec of specs) {
				const { name } = parseSpec(spec);
				const version = installed.find((entry) => entry.name === name)?.version;
				if (version) section[name] = `^${version}`;
			}
			manifest[field] = Object.fromEntries(
				Object.entries(section).sort(([a], [b]) => a.localeCompare(b)),
			);
			fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
		}
		const seconds = ((performance.now() - started) / 1000).toFixed(1);
		if (dryRun)
			return ok(
				`${installed.map((entry) => `add ${entry.name} ${entry.version}`).join("\n")}\n\nwould add ${installed.length} package${installed.length === 1 ? "" : "s"} (dry run, ${seconds}s)\n`,
			);
		return ok(
			`\nadded ${installed.length} package${installed.length === 1 ? "" : "s"} in ${seconds}s\n`,
			log.length > 0 ? `${log.join("\n")}\n` : "",
		);
	};

	const npm = defineCommand("npm", async (args, ctx) => {
		registry = ctx.env.get("npm_config_registry");
		const [sub, ...rest] = args;
		const specs = rest.filter((arg) => !arg.startsWith("-"));
		try {
			switch (sub) {
				case undefined:
				case "help":
				case "--help":
				case "-h":
					return ok(`${NPM_USAGE}\n`);
				case "-v":
				case "--version":
					return ok(`${NPM_VERSION}\n`);
				case "install":
				case "i":
				case "add":
				case "ci":
					if (rest.includes("--help") || rest.includes("-h")) return ok(`${NPM_USAGE}\n`);
					return withNotice(
						await npmInstall(
							ctx.cwd,
							specs,
							rest.includes("-D") || rest.includes("--save-dev"),
							rest.includes("--dry-run"),
						),
					);
				case "uninstall":
				case "remove":
				case "rm": {
					const root = projectRoot(fs, ctx.cwd, workspaceRoot);
					const manifestFile = joinPath(root, "package.json");
					const manifest = fs.existsSync(manifestFile) ? readJson(fs, manifestFile) : {};
					for (const name of specs) {
						fs.rmSync(joinPath(root, "node_modules", name), { recursive: true, force: true });
						for (const field of ["dependencies", "devDependencies"]) {
							const section = manifest[field] as Record<string, string> | undefined;
							if (section) delete section[name];
						}
					}
					if (fs.existsSync(manifestFile))
						fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
					return ok(`removed ${specs.length} package${specs.length === 1 ? "" : "s"}\n`);
				}
				case "init": {
					const root = normalizePath(ctx.cwd);
					const manifestFile = joinPath(root, "package.json");
					if (fs.existsSync(manifestFile)) return fail("npm: package.json already exists\n");
					const name = root.split("/").pop() ?? "project";
					const manifest = { name, version: "1.0.0", private: true, scripts: {} };
					fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
					return ok(`Wrote to ${manifestFile}\n`);
				}
				case "ls":
				case "list": {
					const root = projectRoot(fs, ctx.cwd, workspaceRoot);
					const manifest = readJson(fs, joinPath(root, "package.json"));
					const lines = Object.keys({
						...((manifest.dependencies as object) ?? {}),
						...((manifest.devDependencies as object) ?? {}),
					}).map((name) => {
						const file = joinPath(root, "node_modules", name, "package.json");
						return fs.existsSync(file)
							? `├── ${name}@${readJson(fs, file).version as string}`
							: `├── UNMET DEPENDENCY ${name}`;
					});
					return ok(`${root}\n${lines.join("\n")}\n`);
				}
				case "test":
				case "run":
				case "run-script": {
					const scriptName = sub === "test" ? "test" : specs[0];
					const root = projectRoot(fs, ctx.cwd, workspaceRoot);
					const scripts = (readJson(fs, joinPath(root, "package.json")).scripts ?? {}) as Record<
						string,
						string
					>;
					if (!scriptName)
						return ok(
							`Scripts available in ${root}:\n${Object.keys(scripts)
								.map((s) => `  ${s}\n    ${scripts[s]}`)
								.join("\n")}\n`,
						);
					const script = scripts[scriptName];
					if (!script) return fail(`npm error Missing script: "${scriptName}"\n`);
					if (!ctx.exec) return fail("npm: this shell cannot run scripts\n");
					const extra = (sub === "test" ? rest : rest.slice(1)).filter((arg) => arg !== "--");
					const line = [script, ...extra].join(" ");
					const bins = binsUnder(fs, root);
					const command = line.replace(/^(\S+)/, (first) =>
						bins.has(first) ? `npx ${first}` : first,
					);
					const result = await ctx.exec(command, { cwd: root });
					return { ...result, stdout: `\n> ${scriptName}\n> ${script}\n\n${result.stdout}` };
				}
				default:
					return fail(`npm: '${sub}' is not available in the Playground. Try npm help.\n`);
			}
		} catch (error) {
			return fail(`${(error as Error).message}\n`);
		}
	});

	const npxRun = async (
		ctx: { cwd: string; env: Map<string, string>; stdin: unknown },
		spec: string,
		args: string[],
	): Promise<ExecResult> => {
		const { name, range } = parseSpec(spec);
		const command = name.split("/").pop() ?? name;
		const root = projectRoot(fs, ctx.cwd, workspaceRoot);
		const local = binsUnder(fs, root).get(command);
		if (local) return runEntry(ctx, local, args);
		const log: string[] = [];
		const manifest = await installer(log).resolve(name, range);
		const cacheRoot = joinPath(NPX_CACHE, `${manifest.name.replace("/", "+")}@${manifest.version}`);
		if (!fs.existsSync(joinPath(cacheRoot, "node_modules", manifest.name, "package.json"))) {
			fs.mkdirSync(cacheRoot, { recursive: true });
			await installer(log).install(cacheRoot, { [manifest.name]: manifest.version });
		}
		const bins = binsUnder(fs, cacheRoot);
		const entry = bins.get(command) ?? [...bins.values()][0];
		if (!entry) return fail(`npx: ${manifest.name} has no executable\n`);
		const result = await runEntry(ctx, entry, args, [cacheRoot]);
		return { ...result, stderr: (log.length > 0 ? `${log.join("\n")}\n` : "") + result.stderr };
	};

	const npx = defineCommand("npx", async (args, ctx) => {
		registry = ctx.env.get("npm_config_registry");
		if (args[0] === "--version" || args[0] === "-v") return ok(`${NPM_VERSION}\n`);
		if (args[0] === "--help" || args[0] === "-h") return ok(`${NPX_USAGE}\n`);
		const filtered = args.filter((arg) => arg !== "-y" && arg !== "--yes");
		const packageIndex = filtered.indexOf("-p") >= 0 ? filtered.indexOf("-p") + 1 : -1;
		const spec = packageIndex > 0 ? filtered[packageIndex] : filtered[0];
		if (!spec) return fail("npx: name a package or command\n");
		const rest = packageIndex > 0 ? filtered.slice(packageIndex + 2) : filtered.slice(1);
		try {
			return withNotice(await npxRun(ctx, spec, rest));
		} catch (error) {
			return withNotice(fail(`${(error as Error).message}\n`));
		}
	});

	const tsc = defineCommand("tsc", async (args, ctx) => {
		const root = projectRoot(fs, ctx.cwd, workspaceRoot);
		const spec = binsUnder(fs, root).has("tsc") ? "tsc" : TSC_PACKAGE;
		try {
			const result = await npxRun(ctx, spec, args);
			return withNotice(result);
		} catch (error) {
			return withNotice(fail(`${(error as Error).message}\n`));
		}
	});

	return [node, npm, npx, tsc];
}
