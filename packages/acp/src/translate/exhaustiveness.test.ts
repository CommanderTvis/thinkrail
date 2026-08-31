import { expect, test } from "bun:test";
import type { ProtocolVocabulary } from "../testing";
import { PROTOCOL_VOCABULARIES, PROTOCOL_VOCABULARY_NAMES, vocabularyVariants } from "../testing";
import { CONFIG_OPTION_CATEGORIES } from "./configOptions";
import { CONTENT_BLOCK_TYPES, TOOL_CALL_CONTENT_TYPES } from "./content";
import { PROPERTY_SCHEMA_TYPES } from "./elicitation";
import { OPTION_KINDS } from "./permission";
import { PLAN_PRIORITIES, PLAN_STATUSES } from "./plan";
import { SESSION_UPDATE_VARIANTS } from "./sessionUpdate";
import { STOP_REASONS } from "./settlement";
import { TOOL_CALL_STATUSES, TOOL_KINDS } from "./toolCall";

const TRANSLATED: { readonly [K in ProtocolVocabulary]: readonly string[] } = {
	sessionUpdate: Object.keys(SESSION_UPDATE_VARIANTS),
	contentBlock: Object.keys(CONTENT_BLOCK_TYPES),
	toolContent: Object.keys(TOOL_CALL_CONTENT_TYPES),
	elicitationProperty: Object.keys(PROPERTY_SCHEMA_TYPES),
	toolKind: Object.keys(TOOL_KINDS),
	toolStatus: Object.keys(TOOL_CALL_STATUSES),
	stopReason: Object.keys(STOP_REASONS),
	permissionOptionKind: Object.keys(OPTION_KINDS),
	planStatus: Object.keys(PLAN_STATUSES),
	planPriority: Object.keys(PLAN_PRIORITIES),
	configOptionCategory: Object.keys(CONFIG_OPTION_CATEGORIES),
};

for (const name of PROTOCOL_VOCABULARY_NAMES) {
	test(`${PROTOCOL_VOCABULARIES[name].def} is translated variant for variant`, () => {
		expect([...TRANSLATED[name]].sort()).toEqual(vocabularyVariants(name).sort());
	});
}
