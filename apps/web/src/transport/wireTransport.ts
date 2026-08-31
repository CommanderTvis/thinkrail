import type {
	AppConfig,
	ChatEventPayload,
	ElicitationPush,
	PermissionPush,
	Project,
	ReviewChangedPayload,
	ServerWelcome,
	SessionDeletedPayload,
	Workspace,
	WorkspaceFsChangedPayload,
	WorkspaceRemoved,
} from "@thinkrail/contracts";
import { WS_CHANNELS } from "@thinkrail/contracts";
import { useAppStore } from "../store";
import { WsTransport } from "./transport";

let transport: WsTransport | null = null;

export function initTransport(): WsTransport {
	if (transport) return transport;
	transport = new WsTransport({
		onStatus: (status) => useAppStore.getState().setStatus(status),
	});

	transport.subscribe(WS_CHANNELS.serverWelcome, (data) => {
		const welcome = data as Partial<ServerWelcome>;
		if (typeof welcome.protocolVersion !== "number" || !Array.isArray(welcome.projects)) return;
		useAppStore
			.getState()
			.installWelcomeSnapshot(
				welcome.protocolVersion,
				welcome.projects,
				Array.isArray(welcome.recentProjects) ? welcome.recentProjects : welcome.projects,
				welcome.defaultAgent ?? null,
				welcome.agentProtocolVersion ?? null,
				welcome.config,
				welcome.hostPlatform === "darwin" ||
					welcome.hostPlatform === "linux" ||
					welcome.hostPlatform === "win32"
					? welcome.hostPlatform
					: undefined,
			);
	});

	transport.subscribe(WS_CHANNELS.projectUpdated, (data) => {
		useAppStore.getState().applyProjectUpdated(data as Project);
	});

	transport.subscribe(WS_CHANNELS.chatEvent, (data) => {
		const { sessionId, event } = data as ChatEventPayload;
		useAppStore.getState().applyChatEvent(sessionId, event);
	});

	transport.subscribe(WS_CHANNELS.agentElicitation, (data) => {
		useAppStore.getState().applyElicitation(data as ElicitationPush);
	});

	transport.subscribe(WS_CHANNELS.agentPermission, (data) => {
		useAppStore.getState().applyPermission(data as PermissionPush);
	});

	transport.subscribe(WS_CHANNELS.sessionDeleted, (data) => {
		const { workspaceId, sessionId } = data as SessionDeletedPayload;
		useAppStore.getState().deleteChat(workspaceId, sessionId, false);
	});

	transport.subscribe(WS_CHANNELS.agentChanged, () => {
		useAppStore.getState().noteAgentChanged();
	});

	transport.subscribe(WS_CHANNELS.workspaceCreated, (data) => {
		useAppStore.getState().addWorkspace(data as Workspace);
	});

	transport.subscribe(WS_CHANNELS.workspaceUpdated, (data) => {
		useAppStore.getState().updateWorkspace(data as Workspace);
	});

	transport.subscribe(WS_CHANNELS.workspaceRemoved, (data) => {
		const { projectId, id } = data as WorkspaceRemoved;
		useAppStore.getState().applyWorkspaceRemoved(projectId, id);
	});

	transport.subscribe(WS_CHANNELS.reviewChanged, (data) => {
		const payload = data as ReviewChangedPayload;
		useAppStore.getState().applyReviewChanged(payload);
	});

	transport.subscribe(WS_CHANNELS.workspaceFsChanged, (data) => {
		useAppStore.getState().noteFsChanged(data as WorkspaceFsChangedPayload);
	});

	transport.subscribe(WS_CHANNELS.settingsChanged, (data) => {
		useAppStore.getState().applyConfig(data as AppConfig);
	});

	transport.connect();
	return transport;
}

export function getTransport(): WsTransport {
	if (!transport) throw new Error("transport not initialized — call initTransport() first");
	return transport;
}
