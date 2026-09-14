import { FrontmatterProperties as KitFrontmatterProperties } from "@thinkrail/plugin-ui/markdown";
import { SPEC_TYPES } from "./specDocument";

export function FrontmatterProperties({
	content,
	onEdit,
}: {
	content: string;
	onEdit?: (next: string) => void;
}) {
	return (
		<KitFrontmatterProperties
			content={content}
			{...(onEdit ? { onEdit } : {})}
			typeSuggestions={SPEC_TYPES}
		/>
	);
}
