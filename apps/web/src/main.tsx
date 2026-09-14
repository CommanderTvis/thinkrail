import "./index.css";
import { TooltipProvider } from "@thinkrail/plugin-ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initChatPreferencesPersistence } from "./chat/chatPreferences";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initNavigation } from "./navigation";
import "./panels/coreViewers";
import { initProjectExpansionPersistence } from "./panels/projectExpansion";
import { initPluginLoader } from "./plugins/loader";
import { Shell } from "./shell/Shell";
import { applyThemePreference, initializeBundledThemes, readThemeHint } from "./themes";
import { initTransport } from "./transport";

initializeBundledThemes();
applyThemePreference(readThemeHint());
initTransport();
initPluginLoader();
initChatPreferencesPersistence();
initProjectExpansionPersistence();
initNavigation();

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(
		<StrictMode>
			<ErrorBoundary label="app">
				<TooltipProvider delayDuration={250} skipDelayDuration={400} disableHoverableContent>
					<Shell />
				</TooltipProvider>
			</ErrorBoundary>
		</StrictMode>,
	);
}
