import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { expect as baseExpect, test as base } from "@playwright/test";
import { type WebSocket, WebSocketServer } from "ws";
import { AUTOMATION_PORT, BUNDLE_ID, E2E_HOST_PORT, nativeAppPath, OBSERVER_AUTOMATION_PORT, OBSERVER_PROXY_PORT, PROXY_PORT } from "./launch";
import { WireProxy } from "./wire";
import { writeSolidPng } from "./png";
import { E2E_DATA_DIR } from "../../../../e2e/fixtures/paths";


type TextMatch = string | { source: string; flags: string };
type Query = { testId: string } | { text: string; exact: boolean } | { label: string };
type Filter = {
	hasText?: string | RegExp;
	hasNotText?: string | RegExp;
	attrs?: Record<string, string>;
	attrsNot?: Record<string, string>;
};
type Step = { query: Query; filters: Filter[]; index?: number };

function wireMatch(match: string | RegExp): TextMatch {
	return typeof match === "string" ? match : { source: match.source, flags: match.flags };
}

function wireStep(step: Step) {
	return {
		...step,
		filters: step.filters.map((filter) => ({
			...filter,
			...(filter.hasText === undefined ? {} : { hasText: wireMatch(filter.hasText) }),
			...(filter.hasNotText === undefined ? {} : { hasNotText: wireMatch(filter.hasNotText) }),
		})),
	};
}

export function parseIdentifier(identifier: string): Record<string, string> {
	const [, ...pairs] = identifier.split("|");
	return Object.fromEntries(
		pairs.map((pair) => {
			const at = pair.indexOf("=");
			return at < 0 ? [pair, "true"] : [pair.slice(0, at), pair.slice(at + 1)];
		}),
	);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export class NativeLocator {
	constructor(
		readonly app: NativeApp,
		private readonly steps: Step[],
	) {}

	private get tail(): Step {
		return this.steps[this.steps.length - 1];
	}

	private child(query: Query): NativeLocator {
		return new NativeLocator(this.app, [...this.steps, { query, filters: [] }]);
	}

	private with(change: Partial<Step>): NativeLocator {
		return new NativeLocator(this.app, [...this.steps.slice(0, -1), { ...this.tail, ...change }]);
	}

	getByTestId(testId: string): NativeLocator {
		return this.child({ testId });
	}

	getByText(text: string, options: { exact?: boolean } = {}): NativeLocator {
		return this.child({ text, exact: options.exact ?? false });
	}

	getByLabel(label: string): NativeLocator {
		return this.child({ label });
	}

	filter(filter: Filter): NativeLocator {
		return this.with({ filters: [...this.tail.filters, filter] });
	}

	withAttr(name: string, value: string): NativeLocator {
		return this.filter({ attrs: { [name]: value } });
	}

	withoutAttr(name: string, value: string): NativeLocator {
		return this.filter({ attrsNot: { [name]: value } });
	}

	nth(index: number): NativeLocator {
		return this.with({ index });
	}

	first(): NativeLocator {
		return this.nth(0);
	}

	last(): NativeLocator {
		return this.nth(-1);
	}

	toString(): string {
		return this.steps
			.map(
				(step) =>
					`${JSON.stringify(step.query)}${step.filters.length ? JSON.stringify(step.filters) : ""}${step.index === undefined ? "" : `[${step.index}]`}`,
			)
			.join(" >> ");
	}

	private send<T>(op: string, args?: Record<string, unknown>): Promise<T> {
		return this.app.send<T>(op, this.steps.map(wireStep), args);
	}

	private async action<T>(op: string, args?: Record<string, unknown>): Promise<T> {
		const deadline = Date.now() + 10_000;
		for (;;) {
			try {
				return await this.send<T>(op, args);
			} catch (error) {
				if (Date.now() > deadline) throw new Error(`${this}: ${(error as Error).message}`);
				await sleep(50);
			}
		}
	}

	count(): Promise<number> {
		return this.send("count");
	}

	async isVisible(): Promise<boolean> {
		return (await this.count().catch(() => 0)) > 0;
	}

	async textContent(): Promise<string> {
		const texts = await this.send<string[]>("texts");
		if (texts.length !== 1) throw new Error(`${this} resolved to ${texts.length} elements, expected exactly one`);
		return texts[0];
	}

	allTextContents(): Promise<string[]> {
		return this.send("texts");
	}

	inputValue(): Promise<string> {
		return this.send("value");
	}

	async getAttribute(name: string): Promise<string | undefined> {
		const ids = await this.send<string[]>("testIds");
		if (ids.length !== 1) throw new Error(`${this} resolved to ${ids.length} elements, expected exactly one`);
		return parseIdentifier(ids[0])[name];
	}

	boundingBox(): Promise<{ x: number; y: number; width: number; height: number }> {
		return this.action("box");
	}

	click(options: { button?: "right"; position?: { x: number; y: number } } = {}): Promise<void> {
		const at = options.position ? { pageX: options.position.x, pageY: options.position.y } : {};
		return this.action("press", { ...at, ...(options.button === "right" ? { button: 2 } : {}) });
	}

	longPress(position?: { x: number; y: number }): Promise<void> {
		return this.action("longPress", position ? { pageX: position.x, pageY: position.y } : {});
	}

	hover(): Promise<void> {
		return this.action("hover");
	}

	fill(text: string): Promise<void> {
		return this.action("fill", { text });
	}

	press(key: string): Promise<void> {
		return this.action("key", { key });
	}

	async pasteImage(width: number, height: number): Promise<void> {
		const path = join(E2E_DATA_DIR, `pasted-${width}x${height}.png`);
		writeSolidPng(path, width, height);
		await this.action("paste", { files: [{ uri: `file://${path}`, type: "image/png", name: "pasted.png" }] });
	}

	pressSequentially(text: string): Promise<void> {
		return this.action("type", { text });
	}
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

export class NativeApp {
	private socket: WebSocket | undefined;
	private child: ChildProcess | undefined;
	private sequence = 0;
	private readonly pending = new Map<number, Pending>();
	private connected: (() => void) | undefined;

	private readonly server: WebSocketServer;

	readonly wire: WireProxy;

	constructor(
		private readonly automationPort: number,
		proxyPort: number,
	) {
		this.wire = new WireProxy(proxyPort, E2E_HOST_PORT);
		this.server = new WebSocketServer({ host: "127.0.0.1", port: automationPort });
		this.server.on("connection", (socket) => {
			socket.once("message", () => {
				this.socket = socket;
				socket.on("message", (data) => {
					const reply = JSON.parse(String(data)) as { id: number; ok: boolean; result?: unknown; error?: string };
					const entry = this.pending.get(reply.id);
					this.pending.delete(reply.id);
					if (reply.ok) entry?.resolve(reply.result);
					else entry?.reject(new Error(reply.error));
				});
				this.connected?.();
			});
		});
	}

	send<T>(op: string, chain: unknown[], args?: Record<string, unknown>): Promise<T> {
		const socket = this.socket;
		if (!socket) return Promise.reject(new Error("ThinkRailNative is not connected"));
		const id = ++this.sequence;
		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
			socket.send(JSON.stringify({ id, op, chain, args }));
		});
	}

	getByTestId(testId: string): NativeLocator {
		return new NativeLocator(this, [{ query: { testId }, filters: [] }]);
	}

	getByText(text: string, options: { exact?: boolean } = {}): NativeLocator {
		return new NativeLocator(this, [{ query: { text, exact: options.exact ?? false }, filters: [] }]);
	}

	getByLabel(label: string): NativeLocator {
		return new NativeLocator(this, [{ query: { label }, filters: [] }]);
	}

	async relaunch(options: { keepPreferences?: boolean } = {}): Promise<void> {
		await this.quit();
		if (!options.keepPreferences) clearHostPreferences(this.hostURL);
		this.wire.connections = 0;
		const ready = new Promise<void>((resolve) => {
			this.connected = resolve;
		});
		this.child = spawn(join(nativeAppPath(), "Contents", "MacOS", "ThinkRailNative"), ["-ApplePersistenceIgnoreState", "YES"], {
			env: {
				...process.env,
				THINKRAIL_NATIVE_HOST_URL: this.hostURL,
				THINKRAIL_NATIVE_AUTOMATION_URL: `ws://127.0.0.1:${this.automationPort}`,
			},
			stdio: ["ignore", this.log(), this.log()],
		});
		let timer: NodeJS.Timeout | undefined;
		const child = this.child;
		const failed = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error("ThinkRailNative did not connect to the automation server")), 30_000);
			child.once("exit", (code, signal) => reject(new Error(`ThinkRailNative exited before connecting (${signal ?? code})`)));
		});
		try {
			await Promise.race([ready, failed]);
		} finally {
			clearTimeout(timer);
		}
	}

	async quit(): Promise<void> {
		const child = this.child;
		this.child = undefined;
		this.socket?.close();
		this.socket = undefined;
		for (const entry of this.pending.values()) entry.reject(new Error("ThinkRailNative quit"));
		this.pending.clear();
		if (!child || child.exitCode !== null || child.signalCode !== null) return;
		const exited = new Promise((resolve) => child.once("exit", resolve));
		child.kill("SIGKILL");
		await exited;
	}

	private log(): number {
		const dir = new URL("../test-results/", import.meta.url).pathname;
		mkdirSync(dir, { recursive: true });
		return openSync(join(dir, `app-${this.automationPort}.log`), "a");
	}

	get hostURL(): string {
		return `http://127.0.0.1:${this.wire.port}`;
	}

	async start(): Promise<void> {
		await this.wire.listen();
	}

	async dispose(): Promise<void> {
		await this.quit();
		await new Promise((resolve) => this.server.close(resolve));
		await this.wire.close();
	}

	focusedSelection(): Promise<{ start: number; end: number; text: string } | null> {
		return this.send("focusedSelection", []);
	}

	async clipboard(): Promise<string> {
		return execFileSync("pbpaste", { encoding: "utf8" });
	}
}

function clearHostPreferences(hostURL: string): void {
	let xml: string;
	try {
		xml = execFileSync("defaults", ["export", BUNDLE_ID, "-"], { encoding: "utf8" });
	} catch {
		return;
	}
	for (const [, key] of xml.matchAll(/<key>([^<]*)<\/key>/g))
		if (key?.includes(hostURL)) execFileSync("defaults", ["delete", BUNDLE_ID, key]);
}

type MatcherOptions = { timeout?: number };
type Outcome = { pass: boolean; actual: unknown };

async function poll(isNot: boolean, check: () => Promise<Outcome>, timeout = 10_000): Promise<Outcome> {
	const deadline = Date.now() + timeout;
	for (;;) {
		const result = await check().catch((error: Error) => ({ pass: isNot, actual: error.message }));
		if (result.pass !== isNot || Date.now() > deadline) return result;
		await sleep(50);
	}
}

function report(name: string, locator: NativeLocator, expected: unknown, result: Outcome) {
	return {
		pass: result.pass,
		name,
		expected,
		actual: result.actual,
		message: () => `${name}: ${locator}\nexpected ${JSON.stringify(expected)}\nreceived ${JSON.stringify(result.actual)}`,
	};
}

function textPasses(actual: string, expected: string | RegExp, exact: boolean): boolean {
	if (typeof expected !== "string") return expected.test(actual);
	return exact ? actual.trim() === expected : actual.includes(expected);
}

export const expect = baseExpect.extend({
	async toBeShown(this: { isNot: boolean }, locator: NativeLocator, options: MatcherOptions = {}) {
		const result = await poll(
			this.isNot,
			async () => {
				const visible = await locator.isVisible();
				return { pass: visible, actual: visible ? "visible" : "hidden" };
			},
			options.timeout,
		);
		return report("toBeShown", locator, this.isNot ? "hidden" : "visible", result);
	},
	async toHaveElements(this: { isNot: boolean }, locator: NativeLocator, count: number, options: MatcherOptions = {}) {
		const result = await poll(
			this.isNot,
			async () => {
				const actual = await locator.count();
				return { pass: actual === count, actual };
			},
			options.timeout,
		);
		return report("toHaveElements", locator, count, result);
	},
	async toShowText(
		this: { isNot: boolean },
		locator: NativeLocator,
		expected: string | RegExp,
		options: MatcherOptions = {},
	) {
		const result = await poll(
			this.isNot,
			async () => {
				const actual = await locator.textContent();
				return { pass: textPasses(actual, expected, true), actual };
			},
			options.timeout,
		);
		return report("toShowText", locator, String(expected), result);
	},
	async toContainShownText(
		this: { isNot: boolean },
		locator: NativeLocator,
		expected: string | RegExp,
		options: MatcherOptions = {},
	) {
		const result = await poll(
			this.isNot,
			async () => {
				const actual = await locator.textContent();
				return { pass: textPasses(actual, expected, false), actual };
			},
			options.timeout,
		);
		return report("toContainShownText", locator, String(expected), result);
	},
	async toHaveAttr(
		this: { isNot: boolean },
		locator: NativeLocator,
		name: string,
		expected: string,
		options: MatcherOptions = {},
	) {
		const result = await poll(
			this.isNot,
			async () => {
				const actual = await locator.getAttribute(name);
				return { pass: actual === expected, actual };
			},
			options.timeout,
		);
		return report("toHaveAttr", locator, `${name}=${expected}`, result);
	},
	async toHaveInputValue(
		this: { isNot: boolean },
		locator: NativeLocator,
		expected: string,
		options: MatcherOptions = {},
	) {
		const result = await poll(
			this.isNot,
			async () => {
				const actual = await locator.inputValue();
				return { pass: actual === expected, actual };
			},
			options.timeout,
		);
		return report("toHaveInputValue", locator, expected, result);
	},
});

export const test = base.extend<{ app: NativeApp; wire: WireProxy; openObserver: () => Promise<NativeApp> }>({
	app: async ({}, use) => {
		const clipboard = execFileSync("pbpaste", { encoding: "utf8" });
		const app = new NativeApp(AUTOMATION_PORT, PROXY_PORT);
		await app.start();
		try {
			await use(app);
		} finally {
			await app.dispose();
			execFileSync("pbcopy", { input: clipboard });
		}
	},
	wire: async ({ app }, use) => {
		await use(app.wire);
	},
	openObserver: async ({}, use) => {
		let observer: NativeApp | undefined;
		await use(async () => {
			if (!observer) {
				observer = new NativeApp(OBSERVER_AUTOMATION_PORT, OBSERVER_PROXY_PORT);
				await observer.start();
			}
			await observer.relaunch();
			return observer;
		});
		await observer?.dispose();
	},
});
