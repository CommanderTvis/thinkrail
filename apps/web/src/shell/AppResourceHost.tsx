import {
	type ResourceEnvironment,
	ResourceEnvironmentProvider,
	type ResourceFileReviewProps,
	type ResourceHost,
	ResourceHostProvider,
	type ResourcePreferences,
	ResourcePreferencesProvider,
	type ResourceReviewSendProps,
	registerBundledResourceRenderers,
} from "@thinkrail/resource-renderers";
import { type ReactNode, useMemo } from "react";
import { Markdown } from "../chat/Markdown";
import { cssColorToHex, usePhoneViewport } from "../lib";
import { SHIKI_FILE_LANGUAGES, shikiLanguageId } from "../lib/highlighter";
import { emitEditorEvent, findEditorRef } from "../panels/editorEvents";
import { openFileComparisonInTab, openFileInTab } from "../panels/openTabs";
import { resourceBytesUrl } from "../panels/resourcePane";
import { SendReviewButton } from "../panels/SendReviewButton";
import { sendSelectionToChat } from "../panels/sendSelectionToChat";
import {
	linkifyWikiLinks,
	readSpecDocument,
	SPEC_TYPES,
	specLinkTarget,
	specUrlTransform,
} from "../panels/specDocument";
import { useFileReview } from "../panels/useReviewCommenting";
import { selectSlot, usePluginRegistry } from "../plugins/registry";
import { selectFileChangeSince, useAppStore } from "../store";
import { resolveThinkrailShikiTheme } from "../themes";
import { getTransport, reportIdeDocumentClosed } from "../transport";

registerBundledResourceRenderers();

function FileReview({ workspaceId, path, kind, sessionId, children }: ResourceFileReviewProps) {
	return children(useFileReview(workspaceId, path, kind, undefined, sessionId).worktree);
}

function ReviewSend({ workspaceId, paths, sessionId }: ResourceReviewSendProps) {
	return <SendReviewButton workspaceId={workspaceId} path={paths} chatSessionId={sessionId} />;
}

const HOST: ResourceHost = {
	markdown: Markdown,
	code: {
		languages: SHIKI_FILE_LANGUAGES,
		languageId: shikiLanguageId,
		theme: (options) => resolveThinkrailShikiTheme({ ...options, toHex: cssColorToHex }),
	},
	bytesUrl: resourceBytesUrl,
	openFile: (workspaceId, path, options) => {
		void openFileInTab(workspaceId, path, options?.keep ? "keep" : "preview");
	},
	openComparison: (workspaceId, before, path) => {
		void openFileComparisonInTab(workspaceId, before, path, "keep");
	},
	readFile: (workspaceId, path) => getTransport().request("fs.readFile", { workspaceId, path }),
	subscribeFileChanges: (workspaceId, onChange) =>
		useAppStore.subscribe((state, previous) => {
			const paths = selectFileChangeSince(state, previous, workspaceId);
			if (paths !== undefined) onChange(paths);
		}),
	FileReview,
	ReviewSend,
	specLink: (workspaceId, href) => {
		for (const resolve of selectSlot(usePluginRegistry.getState(), "documentLink")) {
			const target = resolve(workspaceId, href);
			if (target) return { id: href, path: target.path };
		}
		const id = specLinkTarget(href);
		return id === null ? null : { id, path: null };
	},
	documentHeader: {
		title: (_workspaceId, _path, text) => readSpecDocument(text)?.title ?? null,
		typeSuggestions: SPEC_TYPES,
		linkify: (content, body) => (readSpecDocument(content) ? linkifyWikiLinks(body) : body),
		urlTransform: specUrlTransform,
	},
	editor: {
		selectionChange: (change) => {
			const { workspaceId, path, startLine, startColumn, endLine, endColumn, text } = change;
			useAppStore
				.getState()
				.setEditorSelection(
					workspaceId,
					change.empty ? null : { text, startLine, endLine, language: change.language, path },
				);
			const ref = findEditorRef(workspaceId, path);
			if (!ref) return;
			emitEditorEvent({
				kind: "selection",
				editor: ref,
				selection: change.empty
					? null
					: { startLine, startColumn, endLine: change.endColumnLine ?? endLine, endColumn, text },
			});
		},
		sendToChat: (change) => {
			useAppStore.getState().detachEditorSelection(change.workspaceId);
			void sendSelectionToChat(change);
		},
		close: (workspaceId, path) => {
			useAppStore.getState().setEditorSelection(workspaceId, null);
			reportIdeDocumentClosed(workspaceId, path);
		},
	},
};

export function AppResourceHost({ children }: { children: ReactNode }) {
	const fileLineWidth = useAppStore((state) => state.fileLineWidth);
	const fileLineWidthBounded = useAppStore((state) => state.fileLineWidthBounded);
	const editorGpuRendering = useAppStore((state) => state.editorGpuRendering);
	const codeFontLigatures = useAppStore((state) => state.codeFontLigatures);
	const mobile = usePhoneViewport();
	const preferences = useMemo<ResourcePreferences>(
		() => ({ fileLineWidth, fileLineWidthBounded, editorGpuRendering, codeFontLigatures }),
		[fileLineWidth, fileLineWidthBounded, editorGpuRendering, codeFontLigatures],
	);
	const environment = useMemo<ResourceEnvironment>(() => ({ mobile }), [mobile]);
	return (
		<ResourceHostProvider value={HOST}>
			<ResourcePreferencesProvider value={preferences}>
				<ResourceEnvironmentProvider value={environment}>{children}</ResourceEnvironmentProvider>
			</ResourcePreferencesProvider>
		</ResourceHostProvider>
	);
}
