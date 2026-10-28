import { Buffer } from "buffer";

const scope = globalThis as Record<string, unknown>;
scope.Buffer ??= Buffer;
scope.$RefreshReg$ ??= () => undefined;
scope.$RefreshSig$ ??= () => (type: unknown) => type;
