import {
	IconTooltip,
	RowAction,
	ScopedSettingRow,
	SettingsToolbar,
	shapeOf,
} from "@thinkrail/plugin-ui";
import { useState } from "react";
import type { ClaudeSettingValue } from "../contracts";
import type { EditRequest, OpenSource } from "./ClaudeConfigParts";
import { ClaudeValueDialog } from "./ClaudeValueDialog";

type Composing = { key: string; value: unknown } | null;

export function ClaudeSettingsSurface({
	settings,
	knownKeys,
	onOpen,
	onEdit,
}: {
	settings: ClaudeSettingValue[];
	knownKeys: readonly string[];
	onOpen: OpenSource;
	onEdit: EditRequest;
}) {
	const [query, setQuery] = useState("");
	const [composing, setComposing] = useState<Composing>(null);
	const shown = settings.filter((entry) => entry.key.toLowerCase().includes(query.toLowerCase()));

	const compose = (pending: Parameters<EditRequest>[0]) => {
		setComposing(null);
		onEdit(pending);
	};

	return (
		<div className="flex min-h-0 flex-col">
			<ClaudeValueDialog
				// Remounted per key: it seeds its fields from the value it was opened on.
				key={composing ? composing.key || "new" : "idle"}
				open={composing !== null}
				settingKey={composing?.key ?? ""}
				currentValue={composing?.value}
				knownKeys={knownKeys}
				onClose={() => setComposing(null)}
				onCompose={compose}
			/>

			<SettingsToolbar
				testIdPrefix="claude"
				query={query}
				onQuery={setQuery}
				onAdd={() => setComposing({ key: "", value: undefined })}
			/>
			<div className="min-h-0 flex-1 overflow-auto">
				{shown.map((entry) => (
					<ScopedSettingRow
						key={entry.key}
						testIdPrefix="claude"
						settingKey={entry.key}
						docsUrl={entry.docsUrl}
						docsTitle="What this key does, in Claude Code's reference"
						source={entry.origin}
						shadowed={entry.shadowed.map((shadow) => ({ value: shadow.value, ...shadow.origin }))}
						onOpen={(path) => onOpen(path, entry.origin.keyPath)}
						value={
							shapeOf(entry.value) === null ? (
								<span
									title={JSON.stringify(entry.value)}
									className="line-clamp-4 min-w-0 flex-1 break-all tr-code-text text-primary"
								>
									{JSON.stringify(entry.value)}
								</span>
							) : (
								<IconTooltip label="Edit">
									<button
										type="button"
										data-testid="claude-setting-change"
										aria-label={`Edit ${entry.key}`}
										onClick={() => setComposing({ key: entry.key, value: entry.value })}
										className="min-w-0 flex-1 text-left tr-code-text text-primary hover:underline"
									>
										{/* line-clamp needs -webkit-box, which a button refuses — keep it on the span. */}
										<span className="line-clamp-4 break-all">{JSON.stringify(entry.value)}</span>
									</button>
								</IconTooltip>
							)
						}
						actions={
							<>
								{shapeOf(entry.value) === null ? (
									<span
										data-testid="claude-setting-uneditable"
										title="Only text, numbers, on/off and lists of text are editable here"
										className="shrink-0 tr-text-label-pill text-text-subtle uppercase"
									>
										edit as a file
									</span>
								) : null}
								<RowAction
									testid="claude-setting-remove"
									label="Remove"
									tone="danger"
									onClick={() =>
										onEdit({
											edit: { kind: "setting", key: entry.key, value: null },
											title: `Remove "${entry.key}"`,
										})
									}
								/>
							</>
						}
					/>
				))}
				{shown.length === 0 ? (
					<p className="p-8 tr-text-ui text-text-muted">No keys match.</p>
				) : null}
			</div>
		</div>
	);
}
