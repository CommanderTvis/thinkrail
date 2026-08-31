import type {
	CreateElicitationRequest,
	CreateElicitationResponse,
	ElicitationPropertySchema,
} from "@agentclientprotocol/sdk";
import type {
	ElicitationChoice,
	ElicitationField,
	ElicitationRequest,
	ElicitationResponse,
} from "@thinkrail/contracts";
import type { DeclaredVariants, UnknownRecord } from "./guards";
import {
	asArray,
	asBoolean,
	asFilledString,
	asNumber,
	asRecord,
	asString,
	asStringArray,
	assertNever,
	isVariant,
} from "./guards";

export const PROPERTY_SCHEMA_TYPES = {
	string: true,
	number: true,
	integer: true,
	boolean: true,
	array: true,
} as const satisfies DeclaredVariants<ElicitationPropertySchema["type"]>;

export function toElicitationRequest(
	request: CreateElicitationRequest,
	mintedId: string,
): ElicitationRequest | undefined {
	const raw = asRecord(request);
	if (raw === undefined) return undefined;
	const message = asString(raw.message) ?? "";
	const sessionId = asFilledString(raw.sessionId);
	const scope = sessionId !== undefined ? { sessionId } : {};

	if (raw.mode === "url") {
		const url = asFilledString(raw.url);
		if (url === undefined) return undefined;
		return {
			kind: "url",
			id: asFilledString(raw.elicitationId) ?? mintedId,
			...scope,
			message,
			url,
		};
	}
	if (raw.mode !== "form") return undefined;

	const schema = asRecord(raw.requestedSchema);
	const fields = toFields(schema);
	if (fields === undefined) return undefined;
	const toolCallId = asFilledString(raw.toolCallId);
	const title = schema === undefined ? undefined : asFilledString(schema.title);
	return {
		kind: "form",
		id: mintedId,
		...scope,
		...(toolCallId !== undefined ? { toolCallId } : {}),
		message,
		...(title !== undefined ? { title } : {}),
		fields,
	};
}

export function toElicitationOutcome(response: ElicitationResponse): CreateElicitationResponse {
	switch (response.outcome) {
		case "accepted":
			return {
				action: "accept",
				...(response.values !== undefined ? { content: response.values } : {}),
			};
		case "declined":
			return { action: "decline" };
		case "cancelled":
			return { action: "cancel" };
		default:
			return assertNever(response.outcome);
	}
}

function toFields(schema: UnknownRecord | undefined): ElicitationField[] | undefined {
	const properties = schema === undefined ? undefined : asRecord(schema.properties);
	if (properties === undefined) return [];
	const required = new Set(
		(schema === undefined ? undefined : asStringArray(schema.required)) ?? [],
	);
	const fields: ElicitationField[] = [];
	for (const [name, property] of Object.entries(properties)) {
		const field = toField(name, asRecord(property), required.has(name));
		if (field === undefined) {
			if (required.has(name)) return undefined;
			continue;
		}
		fields.push(field);
	}
	return fields;
}

function toField(
	name: string,
	raw: UnknownRecord | undefined,
	required: boolean,
): ElicitationField | undefined {
	if (raw === undefined) return undefined;
	const description = asFilledString(raw.description);
	const common = {
		name,
		label: asFilledString(raw.title) ?? name,
		...(description !== undefined ? { description } : {}),
	};
	const asked = required ? { required: true } : {};

	if (!isVariant(raw.type, PROPERTY_SCHEMA_TYPES)) return undefined;
	switch (raw.type) {
		case "string": {
			const options = toChoices(raw.oneOf, raw.enum);
			const defaultValue = asString(raw.default);
			const withDefault = defaultValue !== undefined ? { defaultValue } : {};
			if (options !== undefined) {
				return { ...common, ...asked, type: "select", ...withDefault, options };
			}
			return { ...common, ...asked, type: "text", ...withDefault };
		}
		case "integer":
		case "number": {
			const defaultValue = asNumber(raw.default);
			const min = asNumber(raw.minimum);
			const max = asNumber(raw.maximum);
			return {
				...common,
				...asked,
				type: "number",
				...(defaultValue !== undefined ? { defaultValue } : {}),
				...(raw.type === "integer" ? { integer: true } : {}),
				...(min !== undefined ? { min } : {}),
				...(max !== undefined ? { max } : {}),
			};
		}
		case "boolean": {
			const defaultValue = asBoolean(raw.default);
			return {
				...common,
				type: "boolean",
				...(defaultValue !== undefined ? { defaultValue } : {}),
			};
		}
		case "array": {
			const items = asRecord(raw.items);
			const options = items === undefined ? undefined : toChoices(items.anyOf, items.enum);
			if (options === undefined) return undefined;
			const defaultValue = asStringArray(raw.default);
			const min = asNumber(raw.minItems);
			const max = asNumber(raw.maxItems);
			return {
				...common,
				...asked,
				type: "multiSelect",
				...(defaultValue !== undefined ? { defaultValue } : {}),
				options,
				...(min !== undefined ? { min } : {}),
				...(max !== undefined ? { max } : {}),
			};
		}
		default:
			return assertNever(raw.type);
	}
}

function toChoices(titled: unknown, bare: unknown): ElicitationChoice[] | undefined {
	const out: ElicitationChoice[] = [];
	for (const entry of asArray(titled)) {
		const raw = asRecord(entry);
		const value = raw === undefined ? undefined : asString(raw.const);
		if (raw === undefined || value === undefined) continue;
		const description = asFilledString(raw.description);
		out.push({
			value,
			label: asFilledString(raw.title) ?? value,
			...(description !== undefined ? { description } : {}),
		});
	}
	if (out.length > 0) return out;
	const values = asStringArray(bare);
	if (values === undefined || values.length === 0) return undefined;
	return values.map((value) => ({ value, label: value }));
}
