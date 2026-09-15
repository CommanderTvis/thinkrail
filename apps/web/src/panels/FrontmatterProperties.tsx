import { FrontmatterProperties as KitFrontmatterProperties } from "@/panels/FrontmatterPropertiesTable";
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
