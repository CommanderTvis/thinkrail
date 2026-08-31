import type {
	CreateElicitationResponse,
	ElicitationPropertySchema,
	ElicitationSchema,
} from "@agentclientprotocol/sdk";
import type {
	AskUserQuestionAnswer,
	AskUserQuestionArgs,
	AskUserQuestionItem,
	AskUserQuestionResult,
} from "@thinkrail/contracts";
import type { ExtUiDialog } from "../engine";

const OTHER_SUFFIX = "_other";

const questionKey = (index: number): string => `q${index}`;

function optionsOf(question: AskUserQuestionItem): { const: string; title: string }[] {
	return question.options.map((option) => ({
		const: option.label,
		title: option.label,
		...(option.description ? { description: option.description } : {}),
	}));
}

export function questionnaireSchema(args: AskUserQuestionArgs): ElicitationSchema {
	const properties: { [name: string]: ElicitationPropertySchema } = {};
	args.questions.forEach((question, index) => {
		const key = questionKey(index);
		properties[key] = question.multiSelect
			? {
					type: "array",
					title: question.header,
					description: question.question,
					items: { type: "string", anyOf: optionsOf(question) },
				}
			: {
					type: "string",
					title: question.header,
					description: question.question,
					oneOf: optionsOf(question),
				};
		properties[`${key}${OTHER_SUFFIX}`] = {
			type: "string",
			title: "Other",
			description: `Your own answer to: ${question.question}`,
		};
	});
	return { type: "object", properties, required: [] };
}

function accepted(response: CreateElicitationResponse): { [key: string]: unknown } | undefined {
	if (response.action !== "accept") return undefined;
	const content = (response as { content?: unknown }).content;
	if (typeof content !== "object" || content === null) return {};
	return content as { [key: string]: unknown };
}

export function readQuestionnaireAnswers(
	args: AskUserQuestionArgs,
	response: CreateElicitationResponse,
): AskUserQuestionResult {
	const content = accepted(response);
	if (content === undefined) return { answers: [], cancelled: true };

	const answers: AskUserQuestionAnswer[] = [];
	args.questions.forEach((question, index) => {
		const key = questionKey(index);
		const value = content[key];
		const other = content[`${key}${OTHER_SUFFIX}`];
		const custom = typeof other === "string" && other.length > 0 ? other : undefined;

		if (Array.isArray(value)) {
			const selected = value.filter((entry): entry is string => typeof entry === "string");
			if (selected.length === 0 && custom === undefined) return;
			answers.push({
				questionIndex: index,
				question: question.question,
				kind: "multi",
				answer: custom ?? null,
				selected,
			});
			return;
		}
		if (typeof value === "string" && value.length > 0) {
			const preview = question.options.find((option) => option.label === value)?.preview;
			answers.push({
				questionIndex: index,
				question: question.question,
				kind: "option",
				answer: value,
				...(preview !== undefined ? { preview } : {}),
			});
			return;
		}
		if (custom !== undefined) {
			answers.push({
				questionIndex: index,
				question: question.question,
				kind: "custom",
				answer: custom,
			});
		}
	});
	return { answers, cancelled: answers.length === 0 };
}

const DIALOG_FIELD = "value";

export function dialogSchema(dialog: ExtUiDialog): ElicitationSchema {
	const property: ElicitationPropertySchema =
		dialog.kind === "confirm"
			? { type: "boolean", title: dialog.title }
			: dialog.kind === "select"
				? {
						type: "string",
						title: dialog.title,
						oneOf: dialog.options.map((option) => ({ const: option, title: option })),
					}
				: {
						type: "string",
						title: dialog.title,
						...(dialog.kind === "input" && dialog.placeholder !== undefined
							? { description: dialog.placeholder }
							: {}),
						...(dialog.kind === "editor" && dialog.prefill !== undefined
							? { default: dialog.prefill }
							: {}),
					};
	return {
		type: "object",
		title: dialog.title,
		properties: { [DIALOG_FIELD]: property },
		required: [DIALOG_FIELD],
	};
}

export function readDialogAnswer(response: CreateElicitationResponse): string | boolean | null {
	const content = accepted(response);
	if (content === undefined) return null;
	const value = content[DIALOG_FIELD];
	if (typeof value === "string" || typeof value === "boolean") return value;
	return null;
}

export function dialogMessage(dialog: ExtUiDialog): string {
	return dialog.kind === "confirm" ? dialog.message : dialog.title;
}
