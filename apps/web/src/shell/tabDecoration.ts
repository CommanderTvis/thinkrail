import type { TabDecoration, TabRef } from "@thinkrail/plugin-api/web";
import type { LayoutTab } from "./layout";

/** A plan tab has no `TabRef` shape to decorate — every other kind maps onto one directly. */
export function toTabRef(tab: LayoutTab, workspaceId: string): TabRef | null {
	switch (tab.kind) {
		case "terminal":
			return { kind: "terminal", workspaceId, tabKey: tab.tabKey };
		case "tool":
			return { kind: "tool", workspaceId, tool: tab.tool };
		case "file":
		case "external-file":
		case "diff":
			return { kind: tab.kind, workspaceId, path: tab.path };
		case "chat":
			return { kind: "chat", workspaceId, sessionId: tab.sessionId };
		case "document":
			return null;
	}
}

/** The first plugin decoration that answers for a tab, or none; the same rule wherever a tab is drawn. */
export function decorateTab(
	decorators: readonly { value: (ref: TabRef) => TabDecoration | null }[],
	tab: LayoutTab,
	workspaceId: string,
): TabDecoration | null {
	const ref = toTabRef(tab, workspaceId);
	if (!ref) return null;
	for (const entry of decorators) {
		const decoration = entry.value(ref);
		if (decoration) return decoration;
	}
	return null;
}
