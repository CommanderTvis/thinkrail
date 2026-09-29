import * as pluginApiWeb from "@thinkrail/plugin-api/web";
import * as pluginUi from "@thinkrail/plugin-ui";
import * as React from "react";
import * as ReactDOM from "react-dom";

export interface ThinkrailPluginRuntime {
	React: typeof React;
	ReactDOM: typeof ReactDOM;
	pluginApiWeb: typeof pluginApiWeb;
	pluginUi: typeof pluginUi;
}

declare global {
	interface Window {
		__thinkrailPluginRuntime?: ThinkrailPluginRuntime;
	}
}

export function installPluginRuntime(): void {
	if (window.__thinkrailPluginRuntime) return;
	window.__thinkrailPluginRuntime = { React, ReactDOM, pluginApiWeb, pluginUi };
}
