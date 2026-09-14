// Checked-in external plugin fixture for e2e/plugins/fixture — see e2e/SPEC.md.
//
// A host module imported from outside the repo cannot resolve bare specifiers (no `typebox`, no
// `@thinkrail/plugin-api`), so this file hand-writes the contract's typebox schemas as the plain
// JSON-schema-shaped objects `Value.Check` accepts at runtime — this typebox build carries no Kind
// symbol, `Type.Object(...)` is a plain `{ type: "object", ... }` value (verified against
// `node_modules/typebox`). Everything else mirrors the shapes `@thinkrail/plugin-api` declares.

const manifest = {
	id: "e2e-fixture",
	label: "E2E Fixture",
	icon: "puzzle",
	version: "0.1.0",
	apiGeneration: 1,
	wireVersion: 1,
	enabledByDefault: false,
	dependsOn: [],
	host: "host.js",
	web: "web.js",
	styles: "styles.css",
	contributes: {
		sideTools: [
			{ tool: "plugin:e2e-fixture:panel", label: "Fixture", icon: "puzzle", defaultSide: "right" },
		],
		fileViewers: [],
	},
};

const contract = {
	id: "e2e-fixture",
	wireVersion: 1,
	methods: {
		echo: {
			params: {
				type: "object",
				required: ["text"],
				properties: { text: { type: "string" } },
			},
			result: {
				type: "object",
				required: ["text"],
				properties: { text: { type: "string" } },
			},
		},
	},
	channels: {
		pinged: {
			kind: "event",
			payload: {
				type: "object",
				required: ["count"],
				properties: { count: { type: "number" } },
			},
		},
	},
	settings: {
		type: "object",
		properties: { label: { type: "string" } },
	},
};

function activate(ctx) {
	ctx.method("echo", (params) => ({ text: `echo: ${params.text}` }));
}

export default { manifest, contract, activate };
