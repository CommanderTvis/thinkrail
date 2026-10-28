import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";

const NOTE_COPY: Record<string, MessageKey> = {
	default: "auth.login.optionRecommended",
	headless: "auth.login.optionHeadless",
};

export function loginSelectMessage(message: string): string {
	return message.trim().replace(/:$/, "");
}

export function loginOptionParts(
	label: string,
	t: Translator,
): {
	title: string;
	detail?: string;
	recommended: boolean;
} {
	const match = /^(.*\S)\s*\(([^()]+)\)$/.exec(label.trim());
	if (!match?.[1] || !match[2]) return { title: label.trim(), recommended: false };
	const note = match[2].trim();
	const known = NOTE_COPY[note.toLowerCase()];
	return {
		title: match[1],
		detail: known ? t(known) : note.charAt(0).toUpperCase() + note.slice(1),
		recommended: note.toLowerCase() === "default",
	};
}

export function loginPromptMessage(message: string, t: Translator): string {
	return message
		.trim()
		.replace(/\s*\(blank for ([^()]+)\)$/i, (_match, fallback: string) =>
			t("auth.login.promptBlankFor", { fallback }),
		)
		.replace(/press Enter( to continue)?/gi, () =>
			t("auth.login.promptPressContinue", { action: t("common.continue") }),
		);
}

export type LoginPromptBlock = { kind: "text" | "command"; text: string };

export function loginPromptBlocks(message: string): LoginPromptBlock[] {
	return message
		.split(/\n\n+/)
		.filter(Boolean)
		.map((part) =>
			part.startsWith("$ ")
				? { kind: "command", text: part.slice(2) }
				: { kind: "text", text: part },
		);
}
