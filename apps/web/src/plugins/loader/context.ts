import type { AppConfig, LayoutToolId, PluginRosterEntry } from "@thinkrail/contracts";
import type {
	ChannelPayload,
	MethodResult,
	PluginContract,
	PluginSettings,
} from "@thinkrail/plugin-api";
import { pluginChannelName, pluginMethodName, pluginPreferenceKey } from "@thinkrail/plugin-api";
import type {
	EditorRef,
	HostProjection,
	PluginDisposer,
	PluginWebContext,
	PluginWebLogger,
} from "@thinkrail/plugin-api/web";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { shallow } from "zustand/shallow";
import { registerToolRenderer } from "../../chat/toolRegistry";
import { getStablePreferenceAdapter } from "../../clientPreferences";
import { projectRelativePath, randomId } from "../../lib";
import { enterDefaultWorkspace } from "../../panels/defaultWorkspace";
import { onEditorEvent } from "../../panels/editorEvents";
import { isFileTabDirty, saveFileTab } from "../../panels/fileSave";
import { worktreeFileUrl } from "../../panels/filesUrl";
import { openFileInTab } from "../../panels/openTabs";
import {
	type EditorTab,
	embeddedHostKey,
	layoutOpenOptionsForNavigation,
	selectActiveEditorTab,
	selectWorkspaceById,
	selectWorkspaceTick,
	toast,
	useAppStore,
} from "../../store";
import {
	createSessionWithSkillBaseline,
	errorText,
	getTransport,
	reportIdeSelection,
	watchWorkspaceForLiveContent,
} from "../../transport";
import { usePluginRegistry } from "../registry";

function toEditorRef(tab: EditorTab | null): EditorRef | null {
	if (!tab || (tab.kind !== "file" && tab.kind !== "external-file" && tab.kind !== "diff"))
		return null;
	return {
		id: tab.id,
		workspaceId: tab.workspaceId,
		path: tab.path,
		kind: tab.kind,
		dirty: isFileTabDirty(tab),
	};
}

function findTab(id: string): { workspaceId: string; tab: EditorTab } | null {
	for (const [workspaceId, tabs] of Object.entries(useAppStore.getState().tabsByWorkspace)) {
		const tab = tabs.find((candidate) => candidate.id === id);
		if (tab) return { workspaceId, tab };
	}
	return null;
}

function canonicalPath(workspaceId: string, path: string): string {
	return projectRelativePath(
		path,
		selectWorkspaceById(useAppStore.getState(), workspaceId)?.worktreePath,
	);
}

function buildConfigProjection(state: ReturnType<typeof useAppStore.getState>): AppConfig {
	return {
		theme: state.theme,
		themeMode: state.themeMode,
		...(state.systemThemePair ? { systemThemePair: state.systemThemePair } : {}),
		analyticsEnabled: state.analyticsEnabled,
		terminalReplayKb: state.terminalReplayKb,
		composerGrowthLimit: state.composerGrowthLimit,
		chatLineWidth: state.chatLineWidth,
		fileLineWidth: state.fileLineWidth,
		chatLineWidthBounded: state.chatLineWidthBounded,
		fileLineWidthBounded: state.fileLineWidthBounded,
		customLayoutPresets: state.customLayoutPresets,
		...(state.reviewModel ? { reviewModel: state.reviewModel } : {}),
		...(state.reviewEffort ? { reviewEffort: state.reviewEffort } : {}),
		reviewAutoFix: state.reviewAutoFix,
		subagentsEnabled: state.subagentsEnabled,
		jbcentralQuotaEnabled: state.jbcentralQuotaEnabled,
		jbcentralQuotaRefreshSeconds: state.jbcentralQuotaRefreshSeconds,
		terminalWindowsShell: state.terminalWindowsShell,
		editorGpuRendering: state.editorGpuRendering,
		codeFontFamily: state.codeFontFamily,
		codeFontLigatures: state.codeFontLigatures,
		plugins: state.plugins,
		pluginPaths: state.pluginPaths,
	};
}

function buildTerminalsProjection(
	terminalsByWorkspace: ReturnType<typeof useAppStore.getState>["terminalsByWorkspace"],
): HostProjection["terminals"] {
	return Object.fromEntries(
		Object.entries(terminalsByWorkspace).map(([workspaceId, tabs]) => [
			workspaceId,
			tabs.map((tab) => ({
				tabKey: tab.tabKey,
				title: tab.title,
				...(tab.agent ? { agent: tab.agent } : {}),
			})),
		]),
	);
}

function buildWorkspaceRevisions(
	fsChangesByWorkspace: ReturnType<typeof useAppStore.getState>["fsChangesByWorkspace"],
): HostProjection["workspaceRevisions"] {
	return Object.fromEntries(
		Object.entries(fsChangesByWorkspace).map(([workspaceId, change]) => [workspaceId, change.tick]),
	);
}

function buildHostProjection(state: ReturnType<typeof useAppStore.getState>): HostProjection {
	return {
		projects: state.projects,
		workspaces: state.workspaces,
		activeWorkspaceId: state.activeWorkspaceId,
		contextProjectId: selectWorkspaceById(state, state.activeWorkspaceId ?? "")?.projectId ?? null,
		activeEditor: toEditorRef(selectActiveEditorTab(state, state.activeWorkspaceId ?? "")),
		config: buildConfigProjection(state),
		terminals: buildTerminalsProjection(state.terminalsByWorkspace),
		workspaceRevisions: buildWorkspaceRevisions(state.fsChangesByWorkspace),
		roster: usePluginRegistry.getState().roster,
		hostPlatform: state.hostPlatform,
	};
}

function matchesScope(
	payload: unknown,
	keyFields: readonly string[],
	scope: Record<string, unknown>,
): boolean {
	if (typeof payload !== "object" || payload === null) return true;
	return keyFields.every(
		(field) => !(field in scope) || Reflect.get(payload, field) === scope[field],
	);
}

/** Guards every registration method: a plugin declares its contributions during `activate()`, not later. */
export interface ActivationGuard {
	current: boolean;
	disposers: PluginDisposer[];
}

function assertActivating(pluginId: string, activation: ActivationGuard): void {
	if (!activation.current) {
		throw new Error(`plugin "${pluginId}" registered a contribution outside activate()`);
	}
}

export function createWebContext<C extends PluginContract>(
	entry: PluginRosterEntry,
	activation: ActivationGuard,
): PluginWebContext<C> {
	const id = entry.id;
	const log: PluginWebLogger = {
		debug: (msg, fields) => console.debug(`[plugin:${id}]`, msg, fields ?? {}),
		info: (msg, fields) => console.info(`[plugin:${id}]`, msg, fields ?? {}),
		warn: (msg, fields) => console.warn(`[plugin:${id}]`, msg, fields ?? {}),
		error: (msg, fields) => console.error(`[plugin:${id}]`, msg, fields ?? {}),
	};

	// Slices selected individually and the projection memoized — see registry/SPEC.md "Referential stability".
	const useHost: PluginWebContext<C>["useHost"] = (selector) => {
		const projects = useAppStore((state) => state.projects);
		const workspaces = useAppStore((state) => state.workspaces);
		const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);
		const activeTab = useAppStore((state) =>
			selectActiveEditorTab(state, state.activeWorkspaceId ?? ""),
		);
		const terminalsByWorkspace = useAppStore((state) => state.terminalsByWorkspace);
		const fsChangesByWorkspace = useAppStore((state) => state.fsChangesByWorkspace);
		const config = useAppStore(useShallow(buildConfigProjection));
		const roster = usePluginRegistry((state) => state.roster);
		const hostPlatform = useAppStore((state) => state.hostPlatform);
		const projection = useMemo<HostProjection>(
			() => ({
				projects,
				workspaces,
				activeWorkspaceId,
				contextProjectId:
					selectWorkspaceById({ activeWorkspaceId, workspaces }, activeWorkspaceId ?? "")
						?.projectId ?? null,
				activeEditor: toEditorRef(activeTab),
				config,
				terminals: buildTerminalsProjection(terminalsByWorkspace),
				workspaceRevisions: buildWorkspaceRevisions(fsChangesByWorkspace),
				roster,
				hostPlatform,
			}),
			[
				projects,
				workspaces,
				activeWorkspaceId,
				activeTab,
				config,
				terminalsByWorkspace,
				fsChangesByWorkspace,
				roster,
				hostPlatform,
			],
		);
		return selector(projection);
	};

	return {
		id,
		log,

		async request(name, params) {
			const result = await getTransport().request(pluginMethodName(id, String(name)), params);
			return result as MethodResult<C, typeof name>;
		},
		subscribe(channel, handler, scope) {
			const spec = entry.channels[String(channel)];
			const wireChannel = pluginChannelName(id, String(channel));
			const unsubscribe = getTransport().subscribe(wireChannel, (data) => {
				const payload = data as ChannelPayload<C, typeof channel>;
				if (scope && spec?.kind === "state" && !matchesScope(payload, spec.key, scope)) return;
				handler(payload);
			});
			if (spec?.kind !== "state") return unsubscribe;
			let cancelled = false;
			const readSnapshot = (): void => {
				getTransport()
					.request(pluginMethodName(id, spec.snapshot), scope ?? {})
					.then((result) => {
						if (cancelled) return;
						const rows = Array.isArray(result) ? result : [result];
						for (const row of rows) handler(row as ChannelPayload<C, typeof channel>);
					})
					.catch(() => {});
			};
			readSnapshot();
			const stopReconnectWatch = useAppStore.subscribe((state, previous) => {
				if (
					state.status === "connected" &&
					state.connectionGeneration !== previous.connectionGeneration
				) {
					readSnapshot();
				}
			});
			return () => {
				cancelled = true;
				unsubscribe();
				stopReconnectWatch();
			};
		},

		useSettings() {
			return useHost((host) => (host.config.plugins[id] ?? {}) as PluginSettings<C>);
		},
		async patchSettings(patch) {
			await getTransport().request("settings.update", { config: { plugins: { [id]: patch } } });
		},

		useHost,
		host() {
			return buildHostProjection(useAppStore.getState());
		},
		watchHost(selector, listener) {
			let previous = selector(buildHostProjection(useAppStore.getState()));
			const recompute = (): void => {
				const next = selector(buildHostProjection(useAppStore.getState()));
				if (shallow(next, previous)) return;
				const prior = previous;
				previous = next;
				listener(next, prior);
			};
			const unsubscribeApp = useAppStore.subscribe(recompute);
			const unsubscribeRegistry = usePluginRegistry.subscribe(recompute);
			const unsubscribe = () => {
				unsubscribeApp();
				unsubscribeRegistry();
			};
			activation.disposers.push(unsubscribe);
			return unsubscribe;
		},

		settingsSection(section) {
			assertActivating(id, activation);
			usePluginRegistry.getState().addSettingsSection(id, section);
		},

		sideTool(registration) {
			assertActivating(id, activation);
			usePluginRegistry.getState().addSideTool(id, registration);
		},

		companion(registration) {
			assertActivating(id, activation);
			usePluginRegistry.getState().addCompanion(id, registration);
		},
		focusCompanion(host, kind) {
			useAppStore
				.getState()
				.focusEmbeddedPane(host.workspaceId, embeddedHostKey(host.kind, host.key), kind);
		},

		fileViewer(registration) {
			assertActivating(id, activation);
			const declared = entry.contributes.fileViewers[0];
			usePluginRegistry
				.getState()
				.addFileViewer(id, { ...registration, read: declared?.read ?? "text" });
		},

		tabDecoration(decorate) {
			assertActivating(id, activation);
			usePluginRegistry.getState().addTabDecorator(id, decorate);
		},

		launcher(launcher) {
			assertActivating(id, activation);
			usePluginRegistry.getState().addLauncher(id, launcher);
		},
		launchers() {
			return usePluginRegistry.getState().launcherList;
		},
		useLaunchers() {
			return usePluginRegistry((state) => state.launcherList);
		},

		workspaceAction(action) {
			assertActivating(id, activation);
			if (action.scope === "project") usePluginRegistry.getState().addProjectAction(id, action);
			else usePluginRegistry.getState().addWorkspaceAction(id, action);
		},

		terminalAccessory(registration) {
			assertActivating(id, activation);
			usePluginRegistry.getState().addTerminalAccessory(id, registration);
		},

		editors: {
			onEvent: (handler) => onEditorEvent(handler),
			async open(workspaceId, path, options) {
				await openFileInTab(
					workspaceId,
					path,
					options?.preview ? "preview" : "keep",
					undefined,
					undefined,
					options?.raw ? { raw: true } : undefined,
				);
				if (options?.line !== undefined) {
					useAppStore.getState().requestFileLineFocus(workspaceId, path, options.line);
				}
				const canonical = canonicalPath(workspaceId, path);
				const tab = (useAppStore.getState().tabsByWorkspace[workspaceId] ?? []).find(
					(candidate) =>
						(candidate.kind === "file" ||
							candidate.kind === "external-file" ||
							candidate.kind === "diff") &&
						candidate.path === canonical,
				);
				return toEditorRef(tab ?? null);
			},
			close(id) {
				useAppStore.getState().closeTab(id);
			},
			list(workspaceId) {
				const state = useAppStore.getState();
				const workspaceIds = workspaceId ? [workspaceId] : Object.keys(state.tabsByWorkspace);
				const refs: EditorRef[] = [];
				for (const wsId of workspaceIds) {
					for (const tab of state.tabsByWorkspace[wsId] ?? []) {
						const ref = toEditorRef(tab);
						if (ref) refs.push(ref);
					}
				}
				return refs;
			},
			isDirty(id) {
				const found = findTab(id);
				return found ? isFileTabDirty(found.tab) : false;
			},
			async save(id) {
				const found = findTab(id);
				if (found) await saveFileTab(found.workspaceId, id);
			},
			useActive() {
				return useAppStore((state) =>
					toEditorRef(selectActiveEditorTab(state, state.activeWorkspaceId ?? "")),
				);
			},
			reportSelection(editor, selection) {
				if (!selection) return;
				reportIdeSelection({
					workspaceId: editor.workspaceId,
					path: editor.path,
					text: selection.text,
					selection: {
						startLine: selection.startLine,
						startColumn: selection.startColumn,
						endLine: selection.endLine,
						endColumn: selection.endColumn,
					},
				});
			},
		},

		async openTerminal(workspaceId, options) {
			const tabKey = options?.tabKey ?? randomId("terminal");
			const store = useAppStore.getState();
			const known = store.terminalsByWorkspace[workspaceId]?.some((tab) => tab.tabKey === tabKey);
			if (known) {
				store.setActiveTerminalTab(workspaceId, tabKey);
			} else {
				store.addTerminal(workspaceId, options?.command, options?.groupId, "center", true, tabKey);
			}
			return { tabKey };
		},
		async openChat(workspaceId, options) {
			const navigation = useAppStore.getState().beginCenterNavigation(workspaceId);
			const { result, syncedTick } = await createSessionWithSkillBaseline({ workspaceId });
			const store = useAppStore.getState();
			store.openChatSession(
				workspaceId,
				result.sessionId,
				result.model,
				result.thinkingLevel,
				syncedTick,
				layoutOpenOptionsForNavigation(store, workspaceId, navigation),
			);
			if (options?.prompt) {
				store.appendUserMessage(result.sessionId, options.prompt);
				getTransport()
					.request("session.prompt", { sessionId: result.sessionId, text: options.prompt })
					.catch((err) => store.appendErrorTurn(result.sessionId, errorText(err)));
			}
			return { sessionId: result.sessionId };
		},
		enterDefaultWorkspace,
		async pickFile(options) {
			const method = options?.directory ? "dialog.selectDirectory" : "dialog.selectFile";
			const { path } = await getTransport().request(method, {});
			return path;
		},

		fileUrl: worktreeFileUrl,
		assetUrl(path) {
			if (entry.assets === undefined) {
				throw new Error(`plugin ${id} declares no assets`);
			}
			return `${getTransport().httpBase()}/plugin/${id}/${entry.assets}/${path}`;
		},
		useFileRevision(workspaceId) {
			return useAppStore((state) => selectWorkspaceTick(state, workspaceId));
		},
		async watchWorkspace(workspaceId) {
			await watchWorkspaceForLiveContent(workspaceId);
		},

		onReconnect(handler) {
			return useAppStore.subscribe((state, previous) => {
				if (
					state.status === "connected" &&
					state.connectionGeneration !== previous.connectionGeneration
				) {
					handler();
				}
			});
		},
		onWorkspaceRemoved(handler) {
			return useAppStore.subscribe((state, previous) => {
				if (state.removedWorkspaceIds === previous.removedWorkspaceIds) return;
				for (const workspaceId of Object.keys(state.removedWorkspaceIds)) {
					if (!previous.removedWorkspaceIds[workspaceId]) handler(workspaceId);
				}
			});
		},

		revealTool(workspaceId, tool: LayoutToolId) {
			useAppStore.getState().requestToolView(workspaceId, tool);
		},

		setDiffScope(workspaceId, scope) {
			useAppStore.getState().setDiffScope(workspaceId, scope);
		},

		slot(name, resolver) {
			assertActivating(id, activation);
			usePluginRegistry.getState().addSlot(id, name, resolver);
		},

		toolRenderer(name, renderer, options) {
			assertActivating(id, activation);
			registerToolRenderer(name, renderer, options);
			usePluginRegistry.getState().addToolRenderer(id, name);
		},

		preference(key) {
			const fullKey = pluginPreferenceKey(id, key);
			return {
				get: () => getStablePreferenceAdapter()?.getItem(fullKey) ?? null,
				set: (value) => getStablePreferenceAdapter()?.setItem(fullKey, value),
				remove: () => getStablePreferenceAdapter()?.removeItem(fullKey),
			};
		},

		dependency(depContract) {
			return {
				request: async (name, params) => {
					const result = await getTransport().request(
						pluginMethodName(depContract.id, String(name)),
						params,
					);
					return result as MethodResult<typeof depContract, typeof name>;
				},
				subscribe: (channel, handler) =>
					getTransport().subscribe(pluginChannelName(depContract.id, String(channel)), (data) =>
						handler(data as ChannelPayload<typeof depContract, typeof channel>),
					),
			};
		},

		notify(kind, title, description) {
			toast[kind](description ?? title, description ? title : undefined);
		},
	};
}
