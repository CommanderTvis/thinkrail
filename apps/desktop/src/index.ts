import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { stagedClaudePlugin } from "@thinkrail/shared/claudePlugin";
import { channel, version } from "@thinkrail/shared/version";
import Electrobun, {
	ApplicationMenu,
	BrowserView,
	BrowserWindow,
	PATHS,
	Utils,
} from "electrobun/main";
import { installDesktopApplicationMenu } from "./applicationMenu";
import { installExternalNavigation } from "./externalNavigation";
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
import { createElectrobunQuitCoordinator, createElectrobunUpdateController } from "./updates";

type BeforeQuitEvent = ReturnType<typeof Electrobun.events.events.app.beforeQuit>;

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
	const quitCoordinator = createElectrobunQuitCoordinator(() => host.server.shutdown());
	const updateController = await createElectrobunUpdateController({
		isPackaged: Electrobun.app.isPackaged,
		version,
		channel,
		platform: process.platform,
		arch: process.arch,
		restartToUpdate: quitCoordinator.restartToUpdate,
	});
	const rpc = BrowserView.defineRPC<DesktopRpc>({
		maxRequestTime: 5000,
		handlers: {
			requests: {
				getUpdateState: () => updateController.getState(),
				checkForUpdates: async () => {
					await updateController.checkForUpdates();
					return undefined;
				},
				restartToUpdate: async () => {
					await updateController.restartToUpdate();
					return undefined;
				},
			},
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
				await Bun.file(join(PATHS.VIEWS_FOLDER, "preload", "index.js")).text(),
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
		trafficLightOffset: { x: 20, y: 8 },
	});
	const navigationProbePath = neutral
		? undefined
		: process.env.THINKRAIL_DESKTOP_NAVIGATION_PROBE_FILE;
	const removeNavigationListeners = installExternalNavigation(
		Electrobun.events,
		mainWindow.webview.id,
		origin,
		(url) => {
			if (navigationProbePath) writeReady(navigationProbePath, { url });
			else Utils.openExternal(url);
		},
	);
	mainWindow.on("close", removeNavigationListeners);
	updateController.subscribe((state) => rpc.send.updateStateChanged(state));

	let ready = false;
	mainWindow.webview.on("dom-ready", () => {
		if (ready) return;
		ready = true;
		updateController.start();
		const readyPath = process.env.THINKRAIL_DESKTOP_READY_FILE;
		if (readyPath) {
			writeReady(readyPath, {
				origin,
				runtimeDir,
				applicationMenuInstalled,
				pid: process.pid,
				launcherPid: Number(process.env.ELECTROBUN_LAUNCHER_PID),
				windowUrl: neutral ? "about:blank" : `${origin}/${initialRoute}`,
				mode: neutral ? "host" : "ui",
			});
		}
	});

	Electrobun.events.on("before-quit", (event: BeforeQuitEvent) => {
		quitCoordinator.handleBeforeQuit(event);
	});
	const controlPath = process.env.THINKRAIL_DESKTOP_CONTROL_FILE;
	if (controlPath) {
		let navigationProbeStarted = false;
		const poll = setInterval(() => {
			if (!existsSync(controlPath)) return;
			if (navigationProbePath) {
				const command = readFileSync(controlPath, "utf8");
				if (command === "navigate" && !navigationProbeStarted) {
					navigationProbeStarted = true;
					mainWindow.webview.executeJavascript(
						'window.location.assign("https://example.invalid/thinkrail-navigation-probe");',
					);
				}
				if (command !== "stop") return;
			}
			clearInterval(poll);
			Utils.quit();
		}, 50);
	}
	void mainWindow;
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
