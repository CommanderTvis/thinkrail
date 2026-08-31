import { expect, test } from "bun:test";
import type { CreateElicitationResponse } from "@agentclientprotocol/sdk";
import type { AskUserQuestionArgs } from "@thinkrail/contracts";
import {
	dialogMessage,
	dialogSchema,
	questionnaireSchema,
	readDialogAnswer,
	readQuestionnaireAnswers,
} from "./elicitation";

const args: AskUserQuestionArgs = {
	questions: [
		{
			question: "Which date library?",
			header: "Dates",
			options: [
				{ label: "Temporal", description: "Standard, newer" },
				{ label: "date-fns", description: "Tree-shakeable", preview: "```ts\nformat()\n```" },
			],
		},
		{
			question: "Which surfaces should it cover?",
			header: "Scope",
			multiSelect: true,
			options: [
				{ label: "Web", description: "The browser client" },
				{ label: "Host", description: "The engine host" },
			],
		},
	],
};

const accepted = (content: { [key: string]: unknown }): CreateElicitationResponse => ({
	action: "accept",
	content,
});

test("each question gets its own field plus a free-text Other field", () => {
	const schema = questionnaireSchema(args);
	expect(Object.keys(schema.properties ?? {})).toEqual(["q0", "q0_other", "q1", "q1_other"]);
	expect(schema.required).toEqual([]);
});

test("a selected option carries its preview back to the transcript", () => {
	const result = readQuestionnaireAnswers(args, accepted({ q0: "date-fns" }));
	expect(result.cancelled).toBe(false);
	expect(result.answers).toEqual([
		{
			questionIndex: 0,
			question: "Which date library?",
			kind: "option",
			answer: "date-fns",
			preview: "```ts\nformat()\n```",
		},
	]);
});

test("a multi-select keeps the checked options alongside the user's own answer", () => {
	const result = readQuestionnaireAnswers(args, accepted({ q1: ["Web"], q1_other: "Also mobile" }));
	expect(result.answers).toEqual([
		{
			questionIndex: 1,
			question: "Which surfaces should it cover?",
			kind: "multi",
			answer: "Also mobile",
			selected: ["Web"],
		},
	]);
});

test("a free-text answer with no selection is reported as a custom answer", () => {
	const result = readQuestionnaireAnswers(args, accepted({ q0_other: "Luxon" }));
	expect(result.answers).toEqual([
		{
			questionIndex: 0,
			question: "Which date library?",
			kind: "custom",
			answer: "Luxon",
		},
	]);
});

test("a declined or empty elicitation settles as cancelled", () => {
	expect(readQuestionnaireAnswers(args, { action: "decline" })).toEqual({
		answers: [],
		cancelled: true,
	});
	expect(readQuestionnaireAnswers(args, accepted({})).cancelled).toBe(true);
});

test("a confirm dialog asks for a boolean and reads it back", () => {
	const schema = dialogSchema({ kind: "confirm", title: "Delete?", message: "This is permanent." });
	expect(schema.properties?.value).toMatchObject({ type: "boolean", title: "Delete?" });
	expect(schema.required).toEqual(["value"]);
	expect(dialogMessage({ kind: "confirm", title: "Delete?", message: "This is permanent." })).toBe(
		"This is permanent.",
	);
	expect(readDialogAnswer(accepted({ value: true }))).toBe(true);
});

test("a select dialog offers exactly its options, and a declined dialog reads as null", () => {
	const schema = dialogSchema({ kind: "select", title: "Branch", options: ["main", "next"] });
	const property = schema.properties?.value;
	expect(property !== undefined && "oneOf" in property ? property.oneOf : undefined).toEqual([
		{ const: "main", title: "main" },
		{ const: "next", title: "next" },
	]);
	expect(readDialogAnswer({ action: "cancel" })).toBeNull();
});
