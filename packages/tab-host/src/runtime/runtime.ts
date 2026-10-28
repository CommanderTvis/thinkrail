import { Buffer } from "buffer";
import { EventEmitter } from "events";
import { createFsFromVolume, type IFs, Volume } from "memfs";
import * as path from "pathe";
import { transform } from "sucrase";

/** One `node` run: the files it may see, where it starts, and what it runs. */
export interface NodeRunRequest {
	files: Record<string, Uint8Array>;
	cwd: string;
	env: Record<string, string>;
	/** Script path, or absent with `code` for `-e` / `-p`. */
	entry?: string;
	code?: string;
	print?: boolean;
	args: string[];
	stdin: string;
}

export interface NodeRunResult {
	stdout: string;
	stderr: string;
	exitCode: number;
	/** Files written (bytes) or removed (null) during the run. */
	changes: Record<string, Uint8Array | null>;
}

class ExitSignal {
	constructor(readonly code: number) {}
}

const NODE_VERSION = "22.12.0";
const EXTENSIONS = ["", ".js", ".cjs", ".mjs", ".ts", ".cts", ".mts", ".tsx", ".jsx", ".json"];
const CONDITIONS = ["require", "node", "default", "import", "module"];

function format(args: unknown[]): string {
	return args
		.map((arg) => {
			if (typeof arg === "string") return arg;
			if (arg instanceof Error) return arg.stack ?? `${arg.name}: ${arg.message}`;
			try {
				return typeof arg === "object" && arg !== null ? JSON.stringify(arg, null, 2) : String(arg);
			} catch {
				return String(arg);
			}
		})
		.join(" ");
}

function readTree(fs: IFs, dir: string, out: Map<string, Uint8Array>): Map<string, Uint8Array> {
	for (const name of fs.readdirSync(dir) as string[]) {
		const child = path.join(dir, name);
		if (fs.statSync(child).isDirectory()) readTree(fs, child, out);
		else out.set(child, fs.readFileSync(child) as Uint8Array);
	}
	return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

function resolveExports(exports: unknown, subpath: string): string | undefined {
	if (typeof exports === "string") return subpath === "." ? exports : undefined;
	if (Array.isArray(exports)) {
		for (const option of exports) {
			const found = resolveExports(option, subpath);
			if (found) return found;
		}
		return undefined;
	}
	if (!exports || typeof exports !== "object") return undefined;
	const map = exports as Record<string, unknown>;
	const keys = Object.keys(map);
	if (keys.length > 0 && keys.every((key) => !key.startsWith(".") && !key.startsWith("#"))) {
		if (subpath !== ".") return undefined;
		for (const condition of CONDITIONS) {
			if (condition in map) {
				const found = resolveExports(map[condition], ".");
				if (found) return found;
			}
		}
		return undefined;
	}
	if (subpath in map) return resolveExports(map[subpath], ".");
	for (const key of keys) {
		const star = key.indexOf("*");
		if (star < 0) continue;
		const prefix = key.slice(0, star);
		const suffix = key.slice(star + 1);
		if (subpath.startsWith(prefix) && subpath.endsWith(suffix)) {
			const target = resolveExports(map[key], ".");
			return target?.replace("*", subpath.slice(prefix.length, subpath.length - suffix.length));
		}
	}
	return undefined;
}

/** Runs one script against a private volume holding `request.files`, Node-style, and reports what it changed. */
export async function runNode(request: NodeRunRequest): Promise<NodeRunResult> {
	const fs = createFsFromVolume(new Volume());
	fs.mkdirSync("/tmp", { recursive: true });
	for (const [file, bytes] of Object.entries(request.files)) {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, bytes);
	}
	const initial = new Map(Object.entries(request.files));
	let stdout = "";
	let stderr = "";
	let cwd = request.cwd;
	let pendingTimers = 0;
	let pendingFetches = 0;
	let exitCode: number | undefined;

	const emitter = new EventEmitter();
	const stream = (write: (text: string) => void) => ({
		write: (chunk: unknown) => {
			write(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk as Uint8Array));
			return true;
		},
		isTTY: false,
		columns: 100,
		rows: 30,
		on: () => undefined,
		once: () => undefined,
		end: () => undefined,
	});
	const start = performance.now();
	const process = Object.assign(emitter, {
		argv: ["node", request.entry ?? "[eval]", ...request.args],
		argv0: "node",
		execArgv: [],
		execPath: "/usr/local/bin/node",
		env: { ...request.env },
		platform: "linux",
		arch: "x64",
		pid: 1,
		ppid: 0,
		version: `v${NODE_VERSION}`,
		versions: { node: NODE_VERSION },
		release: { name: "node" },
		exitCode: undefined as number | undefined,
		cwd: () => cwd,
		chdir: (dir: string) => {
			cwd = path.resolve(cwd, dir);
		},
		exit: (code?: number) => {
			throw new ExitSignal(code ?? process.exitCode ?? 0);
		},
		stdout: stream((text) => {
			stdout += text;
		}),
		stderr: stream((text) => {
			stderr += text;
		}),
		stdin: { isTTY: false, on: () => undefined, read: () => request.stdin, fd: 0 },
		nextTick: (callback: (...args: unknown[]) => void, ...args: unknown[]) =>
			queueMicrotask(() => callback(...args)),
		hrtime: Object.assign(
			(previous?: [number, number]) => {
				const now = performance.now() - start;
				const seconds = Math.floor(now / 1000);
				const nanos = Math.floor((now % 1000) * 1e6);
				return previous ? [seconds - previous[0], nanos - previous[1]] : [seconds, nanos];
			},
			{ bigint: () => BigInt(Math.floor((performance.now() - start) * 1e6)) },
		),
		uptime: () => (performance.now() - start) / 1000,
		memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }),
		umask: () => 0o22,
		cpuUsage: () => ({ user: 0, system: 0 }),
		emitWarning: (warning: unknown) => {
			stderr += `${format([warning])}\n`;
		},
		binding: () => {
			throw new Error("process.binding is not available in the ThinkRail Playground");
		},
	});

	const console = {
		log: (...args: unknown[]) => {
			stdout += `${format(args)}\n`;
		},
		info: (...args: unknown[]) => {
			stdout += `${format(args)}\n`;
		},
		debug: (...args: unknown[]) => {
			stdout += `${format(args)}\n`;
		},
		error: (...args: unknown[]) => {
			stderr += `${format(args)}\n`;
		},
		warn: (...args: unknown[]) => {
			stderr += `${format(args)}\n`;
		},
		trace: (...args: unknown[]) => {
			stderr += `${format(args)}\n`;
		},
		dir: (value: unknown) => {
			stdout += `${format([value])}\n`;
		},
		table: (value: unknown) => {
			stdout += `${format([value])}\n`;
		},
		time: () => undefined,
		timeEnd: () => undefined,
		assert: (condition: unknown, ...args: unknown[]) => {
			if (!condition) stderr += `Assertion failed: ${format(args)}\n`;
		},
	};

	const settle = (error: unknown) => {
		if (error instanceof ExitSignal) exitCode ??= error.code;
		else {
			stderr += `${format([error])}\n`;
			exitCode ??= 1;
		}
	};
	const guarded =
		(callback: (...args: unknown[]) => void) =>
		(...args: unknown[]) => {
			if (exitCode !== undefined) return;
			try {
				const result = callback(...args) as unknown;
				if (result instanceof Promise) result.catch(settle);
			} catch (error) {
				settle(error);
			}
		};
	const timers = {
		setTimeout: (callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
			pendingTimers++;
			const id = setTimeout(() => {
				pendingTimers--;
				guarded(callback)(...args);
			}, ms);
			return id;
		},
		clearTimeout: (id: ReturnType<typeof setTimeout>) => {
			clearTimeout(id);
			pendingTimers = Math.max(0, pendingTimers - 1);
		},
		setInterval: (callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
			pendingTimers++;
			return setInterval(guarded(callback), ms, ...args);
		},
		clearInterval: (id: ReturnType<typeof setInterval>) => {
			clearInterval(id);
			pendingTimers = Math.max(0, pendingTimers - 1);
		},
		setImmediate: (callback: (...args: unknown[]) => void, ...args: unknown[]) =>
			timers.setTimeout(callback, 0, ...args),
		clearImmediate: (id: ReturnType<typeof setTimeout>) => timers.clearTimeout(id),
	};
	const trackedFetch = async (...args: Parameters<typeof fetch>) => {
		pendingFetches++;
		try {
			return await fetch(...args);
		} finally {
			pendingFetches--;
		}
	};

	const unavailable = (name: string) =>
		new Proxy(
			{},
			{
				get: (_target, key) => {
					if (key === "__esModule" || key === "then") return undefined;
					throw new Error(`node:${name} is not available in this browser tab`);
				},
			},
		);
	const util = {
		format: (...args: unknown[]) => format(args),
		inspect: (value: unknown) => format([value]),
		promisify:
			(fn: (...args: unknown[]) => void) =>
			(...args: unknown[]) =>
				new Promise((resolve, reject) =>
					fn(...args, (error: unknown, value: unknown) => (error ? reject(error) : resolve(value))),
				),
		inherits: (ctor: { prototype: object }, superCtor: { prototype: object }) => {
			Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
		},
		deprecate: <T>(fn: T) => fn,
		debuglog: () => () => undefined,
		isDeepStrictEqual: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b),
		types: { isPromise: (value: unknown) => value instanceof Promise },
		TextEncoder,
		TextDecoder,
	};
	const builtins: Record<string, unknown> = {
		fs,
		"fs/promises": fs.promises,
		path: { ...path, posix: path, default: path },
		"path/posix": path,
		events: Object.assign(EventEmitter, { EventEmitter, once: EventEmitter.once }),
		buffer: { Buffer },
		util,
		os: {
			EOL: "\n",
			platform: () => "linux",
			type: () => "Linux",
			arch: () => "x64",
			release: () => "6.0.0",
			homedir: () => request.env.HOME ?? "/",
			tmpdir: () => "/tmp",
			hostname: () => "thinkrail-tab",
			cpus: () => [],
			totalmem: () => 4 * 1024 ** 3,
			freemem: () => 2 * 1024 ** 3,
			endianness: () => "LE",
			userInfo: () => ({ username: "thinkrail", homedir: request.env.HOME ?? "/" }),
		},
		url: {
			URL,
			URLSearchParams,
			fileURLToPath: (url: string | URL) => new URL(url).pathname,
			pathToFileURL: (file: string) => new URL(`file://${path.resolve(cwd, file)}`),
		},
		process,
		timers,
		"timers/promises": {
			setTimeout: (ms: number, value?: unknown) =>
				new Promise((resolve) => timers.setTimeout(() => resolve(value), ms)),
		},
		assert: Object.assign(
			(condition: unknown, message?: string) => {
				if (!condition) throw new Error(message ?? "Assertion failed");
			},
			{
				ok: (condition: unknown, message?: string) => {
					if (!condition) throw new Error(message ?? "Assertion failed");
				},
				strictEqual: (a: unknown, b: unknown, message?: string) => {
					if (a !== b) throw new Error(message ?? `${String(a)} === ${String(b)}`);
				},
				deepStrictEqual: (a: unknown, b: unknown, message?: string) => {
					if (JSON.stringify(a) !== JSON.stringify(b))
						throw new Error(message ?? "Values are not deeply equal");
				},
			},
		),
		tty: { isatty: () => false },
		crypto: {
			randomUUID: () => crypto.randomUUID(),
			randomBytes: (size: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(size))),
			webcrypto: crypto,
			getRandomValues: (array: Uint8Array) => crypto.getRandomValues(array),
		},
		module: {
			createRequire: (from: string) => makeRequire(path.dirname(from)),
			builtinModules: [],
		},
		child_process: unavailable("child_process"),
		worker_threads: unavailable("worker_threads"),
		net: unavailable("net"),
		http: unavailable("http"),
		https: unavailable("https"),
		zlib: unavailable("zlib"),
	};

	const cache = new Map<string, { exports: unknown }>();
	const packageJson = (dir: string): Record<string, unknown> | null => {
		const file = path.join(dir, "package.json");
		return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8") as string) : null;
	};
	const isFile = (file: string) => fs.existsSync(file) && fs.statSync(file).isFile();
	const asFileOrDir = (base: string): string | undefined => {
		for (const ext of EXTENSIONS) if (isFile(base + ext)) return base + ext;
		if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
			const pkg = packageJson(base);
			const main = pkg
				? (resolveExports(pkg.exports, ".") ?? (pkg.main as string | undefined))
				: undefined;
			if (main) {
				const found = asFileOrDir(path.join(base, main));
				if (found) return found;
			}
			for (const ext of EXTENSIONS.slice(1)) {
				if (isFile(path.join(base, `index${ext}`))) return path.join(base, `index${ext}`);
			}
		}
		return undefined;
	};
	const resolve = (id: string, from: string): string => {
		if (id.startsWith("file://")) id = new URL(id).pathname;
		if (
			id.startsWith("/") ||
			id.startsWith("./") ||
			id.startsWith("../") ||
			id === "." ||
			id === ".."
		) {
			const found = asFileOrDir(path.resolve(from, id));
			if (found) return found;
			throw Object.assign(new Error(`Cannot find module '${id}'`), { code: "MODULE_NOT_FOUND" });
		}
		if (id.startsWith("#")) {
			for (let dir = from; ; dir = path.dirname(dir)) {
				const pkg = packageJson(dir);
				if (pkg) {
					const target = resolveExports(pkg.imports, id);
					const found = target ? asFileOrDir(path.join(dir, target)) : undefined;
					if (found) return found;
					break;
				}
				if (dir === "/") break;
			}
			throw Object.assign(new Error(`Cannot find module '${id}'`), { code: "MODULE_NOT_FOUND" });
		}
		const parts = id.split("/");
		const name = id.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? id);
		const subpath = id.slice(name.length);
		for (let dir = from; ; dir = path.dirname(dir)) {
			const pkgDir = path.join(dir, "node_modules", name);
			if (fs.existsSync(pkgDir)) {
				const pkg = packageJson(pkgDir);
				const exported = pkg?.exports ? resolveExports(pkg.exports, `.${subpath}`) : undefined;
				const found = asFileOrDir(exported ? path.join(pkgDir, exported) : pkgDir + subpath);
				if (found) return found;
			}
			if (dir === "/") break;
		}
		throw Object.assign(new Error(`Cannot find module '${id}'`), { code: "MODULE_NOT_FOUND" });
	};
	const isModuleType = (file: string): boolean => {
		for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
			const pkg = packageJson(dir);
			if (pkg) return pkg.type === "module";
			if (dir === "/") return false;
		}
	};
	const compile = (file: string, source: string, topLevel: boolean): string => {
		const typescript = /\.(c|m)?tsx?$/.test(file);
		const esm =
			file.endsWith(".mjs") ||
			file.endsWith(".mts") ||
			(!file.endsWith(".cjs") && !file.endsWith(".cts") && isModuleType(file)) ||
			/^\s*(import|export)\s/m.test(source);
		let code = source.replace(/^#!.*/, "");
		if (esm || typescript) {
			code = code
				.replace(/\bimport\.meta\.url\b/g, 'require("url").pathToFileURL(__filename).href')
				.replace(/\bimport\.meta\.dirname\b/g, "__dirname")
				.replace(/\bimport\.meta\.filename\b/g, "__filename")
				.replace(/\bimport\.meta\b/g, '({ url: require("url").pathToFileURL(__filename).href })');
			code = transform(code, {
				transforms: [
					...(esm ? ["imports" as const] : []),
					...(typescript ? ["typescript" as const] : []),
					...(file.endsWith("x") ? ["jsx" as const] : []),
				],
				filePath: file,
			}).code;
		}
		return topLevel && /\bawait\b/.test(code) ? `return (async () => {\n${code}\n})();` : code;
	};
	const load = (file: string, topLevel = false): { exports: unknown; done?: Promise<unknown> } => {
		const cached = cache.get(file);
		if (cached) return cached;
		const module: { exports: unknown; done?: Promise<unknown> } = { exports: {} };
		cache.set(file, module);
		const source = fs.readFileSync(file, "utf8") as string;
		if (file.endsWith(".json")) {
			module.exports = JSON.parse(source);
			return module;
		}
		const fn = new Function(
			"exports",
			"require",
			"module",
			"__filename",
			"__dirname",
			"process",
			"console",
			"Buffer",
			"global",
			"setTimeout",
			"clearTimeout",
			"setInterval",
			"clearInterval",
			"setImmediate",
			"clearImmediate",
			"fetch",
			`${compile(file, source, topLevel)}\n//# sourceURL=${file}`,
		);
		const result = fn.call(
			module.exports,
			module.exports,
			makeRequire(path.dirname(file)),
			module,
			file,
			path.dirname(file),
			process,
			console,
			Buffer,
			globalThis,
			timers.setTimeout,
			timers.clearTimeout,
			timers.setInterval,
			timers.clearInterval,
			timers.setImmediate,
			timers.clearImmediate,
			trackedFetch,
		);
		if (result instanceof Promise) module.done = result;
		return module;
	};
	function makeRequire(from: string) {
		const require = (id: string) => {
			const builtin = id.startsWith("node:") ? id.slice(5) : id;
			if (builtin in builtins) return builtins[builtin];
			if (id.startsWith("node:"))
				throw new Error(`node:${builtin} is not available in this browser tab`);
			return load(resolve(id, from)).exports;
		};
		return Object.assign(require, {
			resolve: (id: string) => resolve(id, from),
			cache: Object.fromEntries(cache),
			main: undefined,
		});
	}

	try {
		if (request.code !== undefined) {
			const file = path.join(cwd, "[eval].js");
			fs.writeFileSync(file, request.print ? `module.exports = (${request.code});` : request.code);
			const module = load(file, true);
			await module.done;
			if (request.print) stdout += `${format([module.exports])}\n`;
			fs.unlinkSync(file);
		} else if (request.entry) {
			await load(resolve(path.resolve(cwd, request.entry), cwd), true).done;
		}
		while ((pendingTimers > 0 || pendingFetches > 0) && exitCode === undefined) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		exitCode ??= process.exitCode ?? 0;
	} catch (error) {
		settle(error);
	}

	const changes: Record<string, Uint8Array | null> = {};
	const after = readTree(fs, "/", new Map());
	for (const [file, bytes] of after) {
		const before = initial.get(file);
		if (!before || !sameBytes(before, bytes)) changes[file] = bytes;
	}
	for (const file of initial.keys()) if (!after.has(file)) changes[file] = null;
	return { stdout, stderr, exitCode: exitCode ?? 0, changes };
}
