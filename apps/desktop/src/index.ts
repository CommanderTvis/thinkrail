import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { channel, version } from "@thinkrail/shared/version";
import Electrobun, {
	ApplicationMenu,
	BrowserView,
	BrowserWindow,
	PATHS,
	Utils,
} from "electrobun/bun";
import { installDesktopApplicationMenu } from "./applicationMenu";
import { stagedClaudePlugin } from "./claudePlugin";
import { externalNavigationUrl } from "./externalNavigation";
import { HostPortStore } from "./hostPortStore";
import {
	injectInitialDesktopPreferences,
	readDesktopPreferenceRemove,
	readDesktopPreferenceWrite,
} from "./preferenceAdapter";
import { PreferenceStore } from "./preferenceStore";
import { RouteStore } from "./routeStore";
import type { DesktopRpc } from "./rpc";
import { ptyLibraryName, runtimeTarget } from "./runtimeTarget";
import type { DesktopServerRuntime } from "./serverRuntime";

const BACKEND_PROFILE_ID = "local";
const WINDOW_ID = "main";

function writeReady(path: string, payload: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(payload));
}

async function start(): Promise<void> {
	const applicationMenuInstalled = installDesktopApplicationMenu(ApplicationMenu, process.platform);
	const runtimeDir = join(PATHS.RESOURCES_FOLDER, "app", "runtime");
	// The staged marketplace, not this bundle's own module path — see apps/desktop/SPEC.md.
	process.env.THINKRAIL_CLAUDE_PLUGIN_DIR = stagedClaudePlugin(runtimeDir).pluginDir;
	process.env.BUN_PTY_LIB = join(
		runtimeDir,
		ptyLibraryName(runtimeTarget(process.platform, process.arch)),
	);
	const serverRuntime = (await import(
		pathToFileURL(join(runtimeDir, "server-runtime.ts")).href
	)) as DesktopServerRuntime;
	const userData = process.env.THINKRAIL_DESKTOP_USER_DATA ?? Utils.paths.userData;
	// The webview's origin is its storage identity, and the port is in it — see SPEC.md.
	const hostPorts = new HostPortStore(join(userData, "host-ports.json"));
	const host = await serverRuntime.startDesktopHost({
		runtimeDir,
		staticDir: join(PATHS.VIEWS_FOLDER, "web"),
		appVersion: version,
		channel,
		port: hostPorts.read(BACKEND_PROFILE_ID),
	});
	hostPorts.write(BACKEND_PROFILE_ID, host.port);
	const origin = `http://127.0.0.1:${host.port}`;
	const routes = new RouteStore(join(userData, "routes.json"));
	const preferences = new PreferenceStore(join(userData, "preferences.json"));
	const initialRoute = routes.read(BACKEND_PROFILE_ID, WINDOW_ID);
	const initialPreferences = preferences.read(BACKEND_PROFILE_ID, WINDOW_ID);
	const neutral = process.env.THINKRAIL_DESKTOP_E2E_HOST === "1";
	const rpc = BrowserView.defineRPC<DesktopRpc>({
		maxRequestTime: 5000,
		handlers: {
			requests: {},
			messages: {
				routeChanged: ({ hash }) => {
					if (!neutral) routes.write(BACKEND_PROFILE_ID, WINDOW_ID, hash);
				},
				zoomToggle: () => {
					if (mainWindow.isMaximized()) mainWindow.unmaximize();
					else mainWindow.maximize();
				},
				preferenceWrite: (payload) => {
					if (neutral) return;
					const preference = readDesktopPreferenceWrite(payload);
					if (
						preference &&
						!preferences.write(BACKEND_PROFILE_ID, WINDOW_ID, preference.key, preference.value)
					) {
						console.error("[desktop] could not save a local preference");
					}
				},
				preferenceRemove: (payload) => {
					if (neutral) return;
					const preference = readDesktopPreferenceRemove(payload);
					if (preference && !preferences.remove(BACKEND_PROFILE_ID, WINDOW_ID, preference.key)) {
						console.error("[desktop] could not remove a local preference");
					}
				},
			},
		},
	});
	const preload = neutral
		? null
		: injectInitialDesktopPreferences(
				await Bun.file(join(runtimeDir, "preload.js")).text(),
				initialPreferences,
			);
	const mainWindow = new BrowserWindow({
		title: "ThinkRail",
		url: neutral ? "about:blank" : `${origin}/${initialRoute}`,
		preload,
		...(neutral ? {} : { rpc }),
		hidden:
			process.env.THINKRAIL_DESKTOP_HIDDEN === "1" ||
			process.env.THINKRAIL_DESKTOP_E2E_HOST === "1",
		navigationRules: neutral ? null : JSON.stringify(["^*", `${origin}/*`]),
		frame: { x: 80, y: 60, width: 1440, height: 920 },
		// The app's own header is the title bar; macOS keeps only the traffic lights, inset to clear it.
		titleBarStyle: "hiddenInset",
		trafficLightOffset: { x: 20, y: 16 },
	});
	const openExternal = (detail: unknown) => {
		const url = externalNavigationUrl(detail, origin);
		if (url) Utils.openExternal(url);
	};
	mainWindow.webview.on("will-navigate", (event) => openExternal(event.data.detail));
	mainWindow.webview.on("new-window-open", (event) => openExternal(event.data.detail));

	let ready = false;
	mainWindow.webview.on("dom-ready", () => {
		if (ready) return;
		ready = true;
		const readyPath = process.env.THINKRAIL_DESKTOP_READY_FILE;
		if (readyPath) {
			writeReady(readyPath, {
				origin,
				runtimeDir,
				applicationMenuInstalled,
				pid: process.pid,
				windowUrl: neutral ? "about:blank" : `${origin}/${initialRoute}`,
				mode: neutral ? "host" : "ui",
			});
		}
	});

	let shutdownComplete = false;
	let shutdownPromise: Promise<void> | undefined;
	Electrobun.events.on("before-quit", (event) => {
		if (shutdownComplete) return;
		event.response = { allow: false };
		shutdownPromise ??= host.server.shutdown().finally(() => {
			shutdownComplete = true;
			Utils.quit();
		});
	});
	const controlPath = process.env.THINKRAIL_DESKTOP_CONTROL_FILE;
	if (controlPath) {
		const poll = setInterval(() => {
			if (!existsSync(controlPath)) return;
			clearInterval(poll);
			Utils.quit();
		}, 50);
	}
	void mainWindow;
	void shutdownPromise;
}

try {
	await start();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(message);
	await Utils.showMessageBox({
		type: "error",
		title: "ThinkRail could not start",
		message: "ThinkRail could not start",
		detail: message,
		buttons: ["Quit"],
	});
	Utils.quit();
}
