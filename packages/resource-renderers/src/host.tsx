import type { ResourceMeta } from "@thinkrail/contracts";
import type { ComponentProps, ComponentType, ReactNode } from "react";
import { createContext, useContext } from "react";
import type ReactMarkdown from "react-markdown";
import type { LanguageRegistration, ThemeRegistration } from "shiki/core";
import type { ResourceEnvironment, SurfaceReview } from "./registry";

type ReactMarkdownProps = ComponentProps<typeof ReactMarkdown>;

export type MarkdownRehypePlugins = ReactMarkdownProps["rehypePlugins"];

export interface ResourceMarkdownProps {
	text: string;
	className?: string;
	remarkPlugins?: ReactMarkdownProps["remarkPlugins"];
	rehypePlugins?: MarkdownRehypePlugins;
	urlTransform?: ReactMarkdownProps["urlTransform"];
	components?: ReactMarkdownProps["components"];
}

export type ResourceMarkdown = ComponentType<ResourceMarkdownProps>;

export interface ResourceCodeLanguage {
	id: string;
	extensions: readonly string[];
	aliases: readonly string[];
	filenames?: readonly string[];
	load: () => Promise<{ default: LanguageRegistration[] }>;
}

export interface ResourceCodeHost {
	languages: readonly ResourceCodeLanguage[];
	languageId(value: string): string | null;
	theme(options: {
		name: string;
		type: "light" | "dark";
		readVariable: (name: string) => string;
	}): ThemeRegistration;
}

export interface ResourceScope {
	workspaceId: string;
	sessionId?: string | undefined;
}

export interface ResourceReviewSendProps {
	workspaceId: string;
	paths: readonly string[];
	sessionId?: string | undefined;
}

export interface ResourceFileReviewProps {
	workspaceId: string;
	path: string;
	kind: "inline" | "diff";
	sessionId?: string | undefined;
	children: (review: SurfaceReview) => ReactNode;
}

export interface EditorSelectionChange {
	workspaceId: string;
	path: string;
	text: string;
	language: string;
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
	/** The line `endColumn` belongs to, when `endLine` was trimmed back off an unselected trailing line. */
	endColumnLine?: number;
	empty: boolean;
}

export interface ResourceEditorEvents {
	selectionChange(change: EditorSelectionChange): void;
	sendToChat(change: EditorSelectionChange): void;
	close(workspaceId: string, path: string): void;
}

export interface ResourceHost {
	markdown: ResourceMarkdown;
	code: ResourceCodeHost;
	bytesUrl(workspaceId: string, path: string, oid?: string | null): string;
	openFile(workspaceId: string, path: string, options?: { keep?: boolean }): void;
	openComparison(workspaceId: string, before: string, path: string): void;
	readFile(
		workspaceId: string,
		path: string,
	): Promise<{ content: string; meta?: ResourceMeta | undefined }>;
	subscribeFileChanges(
		workspaceId: string,
		onChange: (paths: readonly string[] | null) => void,
	): () => void;
	FileReview: ComponentType<ResourceFileReviewProps>;
	ReviewSend: ComponentType<ResourceReviewSendProps>;
	editor?: ResourceEditorEvents;
	/** What a document says about itself above its body: a title, and the type vocabulary its properties offer. */
	documentHeader?: {
		title(workspaceId: string, path: string, text: string): string | null;
		typeSuggestions?: readonly string[];
		/** Rewrites a body line-for-line when the document names other documents (a spec's `[[id]]`); `content` is the whole file. */
		linkify?(content: string, body: string): string;
		urlTransform?: ReactMarkdownProps["urlTransform"];
	};
	specLink?(workspaceId: string, href: string): { id: string; path: string | null } | null;
}

export interface ResourcePreferences {
	fileLineWidth: number;
	fileLineWidthBounded: boolean;
	editorGpuRendering?: boolean;
	codeFontLigatures?: boolean;
}

const ResourceHostContext = createContext<ResourceHost | null>(null);
const ResourcePreferencesContext = createContext<ResourcePreferences | null>(null);
const ResourceEnvironmentContext = createContext<ResourceEnvironment | null>(null);
const ResourceScopeContext = createContext<ResourceScope | null>(null);

export const ResourceHostProvider = ResourceHostContext.Provider;
export const ResourcePreferencesProvider = ResourcePreferencesContext.Provider;
export const ResourceEnvironmentProvider = ResourceEnvironmentContext.Provider;
export const ResourceScopeProvider = ResourceScopeContext.Provider;

export function useOptionalResourceHost(): ResourceHost | null {
	return useContext(ResourceHostContext);
}

export function useResourceHost(): ResourceHost {
	const host = useContext(ResourceHostContext);
	if (!host) throw new Error("Resource renderers need a ResourceHostProvider");
	return host;
}

export function useResourcePreferences(): ResourcePreferences {
	const preferences = useContext(ResourcePreferencesContext);
	if (!preferences) throw new Error("Resource renderers need a ResourcePreferencesProvider");
	return preferences;
}

export function useResourceScope(): ResourceScope | null {
	return useContext(ResourceScopeContext);
}

export function useResourceEnvironment(): ResourceEnvironment {
	const environment = useContext(ResourceEnvironmentContext);
	if (!environment) throw new Error("Resource renderers need a ResourceEnvironmentProvider");
	return environment;
}
