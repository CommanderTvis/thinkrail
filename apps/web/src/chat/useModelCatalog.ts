import type { ConfigOption, ConfigValue } from "@thinkrail/contracts";
import { useCallback, useState } from "react";
import { useAppStore } from "@/store";
import { getTransport } from "@/transport";

export function useModelCatalog(sessionId: string): {
	refreshing: boolean;
	refresh: () => void;
	selectOption: (optionId: string, value: ConfigValue) => void;
} {
	const [refreshing, setRefreshing] = useState(false);

	const applyOptions = useCallback(
		(options: ConfigOption[]) => {
			useAppStore.getState().applyChatEvent(sessionId, { type: "config_options", options });
		},
		[sessionId],
	);

	const refresh = useCallback(() => {
		setRefreshing(true);
		getTransport()
			.request("agent.refreshConfig", { sessionId })
			.then(applyOptions)
			.catch(() => {})
			.finally(() => setRefreshing(false));
	}, [sessionId, applyOptions]);

	const selectOption = useCallback(
		(optionId: string, value: ConfigValue) => {
			getTransport()
				.request("session.setConfigOption", { sessionId, optionId, value })
				.then(applyOptions)
				.catch(() => {});
		},
		[sessionId, applyOptions],
	);

	return { refreshing, refresh, selectOption };
}
