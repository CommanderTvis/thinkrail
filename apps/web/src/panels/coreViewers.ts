import { type ComponentType, createElement, lazy } from "react";
import { isImagePath } from "@/lib/utils";

export interface FileViewerProps {
	workspaceId: string;
	path: string;
	revision: number;
}

const ImagePreview = lazy(() =>
	import("./ImagePreview").then((module) => ({ default: module.ImagePreview })),
);

function ImageViewer({ workspaceId, path, revision }: FileViewerProps) {
	return createElement(ImagePreview, { workspaceId, path, cacheBust: revision });
}

/** The viewer a path opens in when it is not text, or null for the editor. */
export function coreViewerFor(
	path: string,
): { component: ComponentType<FileViewerProps>; read: "none" } | null {
	return isImagePath(path) ? { component: ImageViewer, read: "none" } : null;
}
