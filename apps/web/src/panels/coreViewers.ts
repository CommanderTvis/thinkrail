import type { FileViewerProps } from "@thinkrail/plugin-api/web";
import { createElement, lazy } from "react";
import { isImagePath } from "@/lib/utils";
import { usePluginRegistry } from "../plugins/registry";

const ImagePreview = lazy(() =>
	import("./ImagePreview").then((module) => ({ default: module.ImagePreview })),
);

function ImageViewer({ workspaceId, path, revision }: FileViewerProps) {
	return createElement(ImagePreview, { workspaceId, path, cacheBust: revision });
}

const registry = usePluginRegistry.getState();
registry.addFileViewer("core", { matches: isImagePath, component: ImageViewer, read: "none" });
