export { reportIdeActiveFile, reportIdeDocumentClosed, reportIdeSelection } from "./editorReports";
export {
	clientErrorReport,
	installClientErrorReporting,
	reportClientError,
} from "./errorReports";
export { errorText } from "./errorText";
export { requestMcpList, watchMcpWorkspace } from "./mcp";
export { RequestError, wsErrorCode } from "./requestError";
export {
	createSessionWithSkillBaseline,
	getSessionMessagesWithSkillBaseline,
	prewarmWorkspaceSkillLoad,
	reloadSessionResourcesWithSkillBaseline,
	watchWorkspaceForLiveContent,
} from "./skillLoad";
export {
	connectToHost,
	deletePlaygroundData,
	gitCorsProxy,
	type HostMode,
	hostMode,
	hostUrl,
	normalizeHostAddress,
	playgroundOnly,
	playgroundWaiting,
	setGitCorsProxy,
	subscribePlaygroundWaiting,
	switchHostMode,
} from "./tabHost";
export type { ConnectionStatus, TransportOptions } from "./transport";
export {
	getTransport,
	initTransport,
	respondToTool,
	runHostUpdate,
	supportsChangeMutations,
	supportsHostUpdateRun,
	supportsPlanReview,
	supportsPlanSummaryGeneration,
	supportsRichAnchors,
	supportsToolResponses,
	supportsTurnChanges,
	supportsUserThemes,
} from "./wireTransport";
