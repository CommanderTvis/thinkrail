// Checked-in external plugin fixture for e2e/plugins/fixture — see e2e/SPEC.md.
//
// Reads React off `window.__thinkrailPluginRuntime` (installed by
// apps/web/src/plugins/loader/runtimeRegistry.ts) instead of bundling its own copy — a second React
// on the page breaks hooks, which is exactly what the loader's own external-web gate refuses.

const { React } = window.__thinkrailPluginRuntime;
const { createElement: h, useState } = React;

function FixtureIcon() {
	return null;
}

function FixtureSettings(ctx) {
	return function FixtureSettingsSection() {
		const settings = ctx.useSettings();
		return h("input", {
			"data-testid": "e2e-fixture-label-input",
			value: settings.label ?? "",
			onChange: (event) => {
				void ctx.patchSettings({ label: event.target.value });
			},
		});
	};
}

function FixturePanel(ctx) {
	return function FixtureSideTool() {
		const [result, setResult] = useState(null);
		return h(
			"div",
			{ "data-testid": "e2e-fixture-panel" },
			h(
				"button",
				{
					"data-testid": "e2e-fixture-echo-button",
					type: "button",
					onClick: () => {
						ctx.request("echo", { text: "hi" }).then((response) => setResult(response.text));
					},
				},
				"Echo",
			),
			result ? h("div", { "data-testid": "e2e-fixture-echo-result" }, result) : null,
		);
	};
}

export function activate(ctx) {
	ctx.settingsSection({
		id: "e2e-fixture",
		label: "E2E Fixture",
		icon: FixtureIcon,
		component: FixtureSettings(ctx),
	});
	ctx.sideTool({
		tool: "plugin:e2e-fixture:panel",
		component: FixturePanel(ctx),
	});
}
