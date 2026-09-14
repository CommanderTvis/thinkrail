import { RiPencilRuler2Line as PencilRuler } from "@remixicon/react";
import type { CompanionHost } from "@thinkrail/plugin-api/web";
import { definePluginWeb } from "@thinkrail/plugin-api/web";
import { createElement, Suspense, useEffect } from "react";
import { BLUEPRINT_FILE } from "../blueprintFile";
import type { blueprintContract } from "../contracts";
import { createBlueprintRawHint } from "./BlueprintRawHint";
import { createBlueprintPane } from "./BlueprintView";
import { createBlueprintOpener } from "./blueprintOpen";
import {
	createDraftBlueprintAction,
	createDraftBlueprintProjectAction,
} from "./DraftBlueprintAction";
import { blueprintAuthors, useBlueprintStore } from "./store";

export default definePluginWeb<typeof blueprintContract>({
	activate(ctx) {
		const { openBlueprintPair } = createBlueprintOpener(ctx);
		const { BlueprintPane } = createBlueprintPane(ctx);

		function useBlueprintAvailable(host: CompanionHost): boolean {
			useEffect(
				() =>
					ctx.subscribe(
						"changed",
						(payload) => useBlueprintStore.getState().setState(host.workspaceId, payload.state),
						{ workspaceId: host.workspaceId },
					),
				[host.workspaceId],
			);
			const state = useBlueprintStore((s) => s.byWorkspace[host.workspaceId]);
			const authors = blueprintAuthors(state, host);
			useEffect(() => {
				if (authors)
					ctx.focusCompanion(
						{ kind: host.kind, workspaceId: host.workspaceId, key: host.key },
						"blueprint",
					);
			}, [authors, host.kind, host.workspaceId, host.key]);
			return authors;
		}

		ctx.companion({
			kind: "blueprint",
			hosts: ["terminal", "chat"],
			title: "Blueprint",
			icon: (props) => createElement(PencilRuler, props),
			useAvailable: useBlueprintAvailable,
			component: ({ host }) =>
				createElement(
					Suspense,
					{ fallback: null },
					createElement(BlueprintPane, { workspaceId: host.workspaceId }),
				),
		});

		ctx.fileViewer({
			matches: (path) => path === BLUEPRINT_FILE,
			component: createBlueprintRawHint(ctx),
			open: (workspaceId) => {
				void openBlueprintPair(workspaceId);
				return true;
			},
		});

		ctx.workspaceAction({
			id: "draft-blueprint",
			component: createDraftBlueprintAction(ctx),
		});
		ctx.workspaceAction({
			id: "draft-blueprint-project",
			scope: "project",
			component: createDraftBlueprintProjectAction(ctx),
		});
	},
});
