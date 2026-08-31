import { expect, test } from "bun:test";
import type { CreateElicitationRequest } from "@agentclientprotocol/sdk";
import type { ElicitationField, ElicitationFormRequest } from "@thinkrail/contracts";
import { toElicitationOutcome, toElicitationRequest } from "./elicitation";

function translate(payload: unknown): ReturnType<typeof toElicitationRequest> {
	return toElicitationRequest(payload as CreateElicitationRequest, "minted");
}

function asForm(payload: unknown): ElicitationFormRequest {
	const request = translate(payload);
	if (request?.kind !== "form") throw new Error("expected a form request");
	return request;
}

function field(form: ElicitationFormRequest, name: string): ElicitationField {
	const found = form.fields.find((entry) => entry.name === name);
	if (found === undefined) throw new Error(`no field named ${name}`);
	return found;
}

test("each property schema becomes the field kind that renders it", () => {
	const form = asForm({
		mode: "form",
		sessionId: "s1",
		message: "Configure the provider",
		requestedSchema: {
			type: "object",
			title: "Provider",
			required: ["key"],
			properties: {
				key: { type: "string", title: "API key", description: "From the dashboard" },
				region: {
					type: "string",
					oneOf: [
						{ const: "eu", title: "Europe", description: "Frankfurt" },
						{ const: "us", title: "United States" },
					],
				},
				retries: { type: "integer", minimum: 0, maximum: 5, default: 3 },
				temperature: { type: "number", default: 0.7 },
				verbose: { type: "boolean", default: true },
				tags: {
					type: "array",
					minItems: 1,
					maxItems: 3,
					items: { anyOf: [{ const: "a", title: "Alpha" }] },
				},
			},
		},
	});

	expect(form.title).toBe("Provider");
	expect(form.sessionId).toBe("s1");
	expect(form.fields.map((entry) => entry.type)).toEqual([
		"text",
		"select",
		"number",
		"number",
		"boolean",
		"multiSelect",
	]);

	expect(field(form, "key")).toEqual({
		name: "key",
		label: "API key",
		description: "From the dashboard",
		required: true,
		type: "text",
	});
	expect(field(form, "region")).toEqual({
		name: "region",
		label: "region",
		type: "select",
		options: [
			{ value: "eu", label: "Europe", description: "Frankfurt" },
			{ value: "us", label: "United States" },
		],
	});
	expect(field(form, "retries")).toEqual({
		name: "retries",
		label: "retries",
		type: "number",
		defaultValue: 3,
		integer: true,
		min: 0,
		max: 5,
	});
	expect(field(form, "temperature")).toEqual({
		name: "temperature",
		label: "temperature",
		type: "number",
		defaultValue: 0.7,
	});
	expect(field(form, "verbose")).toEqual({
		name: "verbose",
		label: "verbose",
		type: "boolean",
		defaultValue: true,
	});
	expect(field(form, "tags")).toEqual({
		name: "tags",
		label: "tags",
		type: "multiSelect",
		options: [{ value: "a", label: "Alpha" }],
		min: 1,
		max: 3,
	});
});

test("a bare enum labels its choices with their own values", () => {
	const form = asForm({
		mode: "form",
		message: "pick",
		requestedSchema: { properties: { colour: { type: "string", enum: ["red", "green"] } } },
	});
	expect(field(form, "colour")).toEqual({
		name: "colour",
		label: "colour",
		type: "select",
		options: [
			{ value: "red", label: "red" },
			{ value: "green", label: "green" },
		],
	});
});

test("an unrenderable optional property is dropped and a required one declines the form", () => {
	const optional = asForm({
		mode: "form",
		message: "pick",
		requestedSchema: {
			properties: { known: { type: "string" }, exotic: { type: "colour-wheel" } },
		},
	});
	expect(optional.fields.map((entry) => entry.name)).toEqual(["known"]);

	expect(
		translate({
			mode: "form",
			message: "pick",
			requestedSchema: {
				required: ["exotic"],
				properties: { known: { type: "string" }, exotic: { type: "colour-wheel" } },
			},
		}),
	).toBeUndefined();
});

test("a multiSelect with no renderable choices is unrenderable", () => {
	expect(
		translate({
			mode: "form",
			message: "pick",
			requestedSchema: { required: ["tags"], properties: { tags: { type: "array", items: {} } } },
		}),
	).toBeUndefined();
});

test("a form with no properties is a message with buttons, not a failure", () => {
	expect(asForm({ mode: "form", message: "Proceed?", requestedSchema: {} }).fields).toEqual([]);
});

test("a tool-scoped form carries the call it belongs to", () => {
	const form = asForm({
		mode: "form",
		sessionId: "s1",
		toolCallId: "t7",
		message: "which one?",
		requestedSchema: {},
	});
	expect(form.toolCallId).toBe("t7");
	expect(form.id).toBe("minted");
});

test("a request-scoped form has no session and still gets an id", () => {
	const form = asForm({ mode: "form", requestId: 12, message: "sign in", requestedSchema: {} });
	expect(form.sessionId).toBeUndefined();
	expect(form.id).toBe("minted");
});

test("url mode keeps the agent's own id, which elicitation/complete later names", () => {
	const request = translate({
		mode: "url",
		sessionId: "s1",
		elicitationId: "e9",
		message: "Finish signing in",
		url: "https://example.test/oauth",
	});
	expect(request).toEqual({
		kind: "url",
		id: "e9",
		sessionId: "s1",
		message: "Finish signing in",
		url: "https://example.test/oauth",
	});
});

test("a mode this client cannot render is declined rather than rendered as another", () => {
	expect(translate({ mode: "voice", message: "speak" })).toBeUndefined();
	expect(translate({ mode: "url", message: "go" })).toBeUndefined();
});

test("the dialog's reply maps onto the action the agent is waiting on", () => {
	expect(toElicitationOutcome({ id: "e1", outcome: "accepted", values: { key: "k" } })).toEqual({
		action: "accept",
		content: { key: "k" },
	});
	expect(toElicitationOutcome({ id: "e1", outcome: "accepted" })).toEqual({ action: "accept" });
	expect(toElicitationOutcome({ id: "e1", outcome: "declined" })).toEqual({ action: "decline" });
	expect(toElicitationOutcome({ id: "e1", outcome: "cancelled" })).toEqual({ action: "cancel" });
});
