import document from "@agentclientprotocol/sdk/schema/schema.json";
import type { ErrorObject } from "ajv/dist/2020";
import { Ajv2020 } from "ajv/dist/2020";
import type { UnknownRecord } from "../translate";
import { asRecord } from "../translate";
import type { FrameDirection, FrameKind } from "./frames";

type CompiledSchema = NonNullable<ReturnType<Ajv2020["getSchema"]>>;

const SCHEMA_KEY = "acp";
const DEF_PREFIX = "#/$defs/";
const EXTENSION_METHOD = /^[_$]/;

const UNION_DEFS: { readonly [D in FrameDirection]: { readonly [K in FrameKind]: string } } = {
	in: { request: "AgentRequest", response: "AgentResponse", notification: "AgentNotification" },
	out: { request: "ClientRequest", response: "ClientResponse", notification: "ClientNotification" },
};

export interface FrameValidation {
	valid: boolean;
	errors: string[];
}

export interface FrameToValidate {
	direction: FrameDirection;
	kind: FrameKind;
	method?: string | undefined;
	payload: unknown;
}

function nodes(value: unknown): UnknownRecord[] {
	if (!Array.isArray(value)) return [];
	const out: UnknownRecord[] = [];
	for (const entry of value) {
		const child = asRecord(entry);
		if (child !== undefined) out.push(child);
	}
	return out;
}

const ROOT = asRecord(document) ?? {};
const DEFS = asRecord(ROOT.$defs) ?? {};

function collectVendorDialect(): { formats: string[]; keywords: string[] } {
	const formats = new Set<string>();
	const keywords = new Set<string>(["discriminator"]);
	const walk = (value: unknown): void => {
		if (Array.isArray(value)) {
			for (const entry of value) walk(entry);
			return;
		}
		const current = asRecord(value);
		if (current === undefined) return;
		for (const [key, child] of Object.entries(current)) {
			if (key === "format" && typeof child === "string") formats.add(child);
			else if (key.startsWith("x-")) keywords.add(key);
			walk(child);
		}
	};
	walk(ROOT);
	return { formats: [...formats], keywords: [...keywords] };
}

function buildAjv(): Ajv2020 {
	const dialect = collectVendorDialect();
	const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
	for (const format of dialect.formats) ajv.addFormat(format, true);
	for (const keyword of dialect.keywords) ajv.addKeyword(keyword);
	ajv.addSchema(ROOT, SCHEMA_KEY);
	return ajv;
}

let compiler: Ajv2020 | undefined;

function validator(defName: string): CompiledSchema {
	compiler ??= buildAjv();
	const compiled = compiler.getSchema(`${SCHEMA_KEY}${DEF_PREFIX}${defName}`);
	if (compiled === undefined) throw new Error(`the ACP schema declares no $defs/${defName}`);
	return compiled;
}

function describe(defName: string, error: ErrorObject): string {
	const where = error.instancePath.length > 0 ? error.instancePath : "/";
	const allowed = error.params.allowedValue;
	const suffix = typeof allowed === "string" ? ` (${allowed})` : "";
	return `${defName} ${where}: ${error.message ?? "is invalid"}${suffix}`;
}

function check(defName: string, value: unknown): string[] {
	const compiled = validator(defName);
	if (compiled(value) === true) return [];
	return (compiled.errors ?? []).map((error) => describe(defName, error));
}

function methodDefs(direction: FrameDirection, kind: FrameKind): Map<string, string> {
	const table = new Map<string, string>();
	const collect = (value: unknown): void => {
		if (Array.isArray(value)) {
			for (const entry of value) collect(entry);
			return;
		}
		const current = asRecord(value);
		if (current === undefined) return;
		for (const [key, child] of Object.entries(current)) {
			if (key === "$ref" && typeof child === "string" && child.startsWith(DEF_PREFIX)) {
				const name = child.slice(DEF_PREFIX.length);
				const method = asRecord(DEFS[name])?.["x-method"];
				if (typeof method === "string") table.set(method, name);
				continue;
			}
			collect(child);
		}
	};
	collect(DEFS[UNION_DEFS[direction][kind]]);
	return table;
}

const METHOD_DEFS = new Map<string, Map<string, string>>();

function methodDef(direction: FrameDirection, kind: FrameKind, method: string): string | undefined {
	const key = `${direction}:${kind}`;
	let table = METHOD_DEFS.get(key);
	if (table === undefined) {
		table = methodDefs(direction, kind);
		METHOD_DEFS.set(key, table);
	}
	return table.get(method);
}

function inner(kind: FrameKind, payload: unknown): { skip: boolean; value: unknown } {
	const frame = asRecord(payload);
	if (kind !== "response") return { skip: false, value: frame?.params };
	if (frame !== undefined && frame.error !== undefined) return { skip: true, value: undefined };
	return { skip: false, value: frame?.result };
}

export function validateFrame(input: FrameToValidate): FrameValidation {
	const unionDef = UNION_DEFS[input.direction][input.kind];
	const errors = check(unionDef, input.payload);
	const method = input.method;
	if (method !== undefined) {
		const defName = methodDef(input.direction, input.kind, method);
		if (defName === undefined) {
			if (!EXTENSION_METHOD.test(method)) {
				errors.push(`${unionDef} /: no ${input.kind} schema is declared for method "${method}"`);
			}
		} else {
			const payload = inner(input.kind, input.payload);
			if (!payload.skip) errors.push(...check(defName, payload.value));
		}
	}
	return { valid: errors.length === 0, errors };
}

export function schemaVariants(defName: string, propName?: string): string[] {
	const def = asRecord(DEFS[defName]);
	if (def === undefined) throw new Error(`the ACP schema declares no $defs/${defName}`);
	const members = def.oneOf !== undefined ? nodes(def.oneOf) : nodes(def.anyOf);
	const values: string[] = [];
	for (const member of members) {
		const declared = asRecord(member.properties)?.[propName ?? ""];
		const holder = propName === undefined ? member : asRecord(declared);
		const value = holder?.const;
		if (typeof value === "string" && !values.includes(value)) values.push(value);
	}
	if (values.length === 0) {
		const where = propName === undefined ? defName : `${defName}.${propName}`;
		throw new Error(`$defs/${where} declares no constant variants`);
	}
	return values;
}

export interface SchemaVocabulary {
	readonly def: string;
	readonly discriminant?: string;
}

export const PROTOCOL_VOCABULARY_NAMES = [
	"sessionUpdate",
	"contentBlock",
	"toolContent",
	"elicitationProperty",
	"toolKind",
	"toolStatus",
	"stopReason",
	"permissionOptionKind",
	"planStatus",
	"planPriority",
	"configOptionCategory",
] as const;

export type ProtocolVocabulary = (typeof PROTOCOL_VOCABULARY_NAMES)[number];

export const PROTOCOL_VOCABULARIES: { readonly [K in ProtocolVocabulary]: SchemaVocabulary } = {
	sessionUpdate: { def: "SessionUpdate", discriminant: "sessionUpdate" },
	contentBlock: { def: "ContentBlock", discriminant: "type" },
	toolContent: { def: "ToolCallContent", discriminant: "type" },
	elicitationProperty: { def: "ElicitationPropertySchema", discriminant: "type" },
	toolKind: { def: "ToolKind" },
	toolStatus: { def: "ToolCallStatus" },
	stopReason: { def: "StopReason" },
	permissionOptionKind: { def: "PermissionOptionKind" },
	planStatus: { def: "PlanEntryStatus" },
	planPriority: { def: "PlanEntryPriority" },
	configOptionCategory: { def: "SessionConfigOptionCategory" },
};

export function vocabularyVariants(name: ProtocolVocabulary): string[] {
	const vocabulary = PROTOCOL_VOCABULARIES[name];
	return schemaVariants(vocabulary.def, vocabulary.discriminant);
}
