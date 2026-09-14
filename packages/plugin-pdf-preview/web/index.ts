import type { FileViewerProps } from "@thinkrail/plugin-api/web";
import { definePluginWeb } from "@thinkrail/plugin-api/web";
import { createElement, lazy } from "react";

const PdfPreview = lazy(() => import("./PdfPreview"));

export default definePluginWeb({
	activate(ctx) {
		function PdfViewer({ workspaceId, path, revision }: FileViewerProps) {
			return createElement(PdfPreview, {
				url: ctx.fileUrl(workspaceId, path),
				cacheBust: revision,
			});
		}

		ctx.fileViewer({ component: PdfViewer });
	},
});
