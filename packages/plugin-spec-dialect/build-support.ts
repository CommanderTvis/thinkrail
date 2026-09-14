import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const entry = require.resolve("pi-spec-graph/index.ts");

export const buildSupport = {
	id: "spec-dialect",
	assets: null,
	pi: {
		extensions: [{ specifier: "pi-spec-graph", entry }],
		skills: [join(dirname(entry), "skills")],
	},
};
