import { createVisualizeExtension } from "./src/extension.ts";

export type { MermaidValidator, VisualizeExtensionOptions } from "./src/extension.ts";
export { createVisualizeExtension } from "./src/extension.ts";
export type { ComparisonOption, VisualizeParams } from "./src/schema.ts";
export { VisualizeSchema } from "./src/schema.ts";
export { validateShape } from "./src/validate.ts";

export default createVisualizeExtension();
