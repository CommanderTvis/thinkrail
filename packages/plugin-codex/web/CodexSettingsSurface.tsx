import {
	IconTooltip,
	RowAction,
	ScopedSettingRow,
	SettingsToolbar,
	SettingValueDialog,
	shapeOf,
} from "@thinkrail/plugin-ui";
import { useState } from "react";
import { CODEX_ADDABLE_KEYS, codexDocsUrl, codexEnumValues, codexValueShape } from "../configDocs";
import type { CodexSetting, CodexValue, CodexWritableScope } from "../contracts";

type Save = (scope: CodexWritableScope, keyPath: string[], value: CodexValue | null) => void;

function display(value: unknown): string {
	return JSON.stringify(value);
}

export function CodexSettingsSurface({
	settings,
	onSave,
	onOpen,
}: {
	settings: CodexSetting[];
	onSave: Save;
	onOpen: (path: string) => void;
}) {
	const [query, setQuery] = useState("");
	const [composing, setComposing] = useState<{
		key: string;
		keyPath: string[];
		value: unknown;
	} | null>(null);
	const shown = settings.filter((entry) => entry.key.toLowerCase().includes(query.toLowerCase()));
	const scopeOf = (key: string): CodexWritableScope =>
		settings.find((entry) => entry.key === key)?.scope === "project" ? "project" : "user";

	return (
		<div className="flex min-h-0 flex-col">
			<SettingValueDialog
				key={composing ? composing.key || "new" : "idle"}
				testIdPrefix="codex"
				open={composing !== null}
				settingKey={composing?.key ?? ""}
				currentValue={composing?.value}
				choices={codexEnumValues}
				shapeFor={codexValueShape}
				knownKeys={CODEX_ADDABLE_KEYS}
				knownKeysOnly
				keyPlaceholder="model_reasoning_effort"
				submitLabel="Save"
				onClose={() => setComposing(null)}
				onSubmit={(key, value) => {
					const keyPath = composing?.key ? composing.keyPath : key.split(".");
					setComposing(null);
					onSave(scopeOf(key), keyPath, value);
				}}
			/>

			<SettingsToolbar
				testIdPrefix="codex"
				query={query}
				onQuery={setQuery}
				onAdd={() => setComposing({ key: "", keyPath: [], value: undefined })}
			/>
			{shown.map((setting) => {
				const editable = setting.scope !== "system" && shapeOf(setting.value) !== null;
				return (
					<ScopedSettingRow
						key={setting.key}
						testIdPrefix="codex"
						settingKey={setting.key}
						docsUrl={codexDocsUrl(setting.key)}
						docsTitle="What this key does, in Codex's configuration reference"
						source={setting}
						shadowed={setting.shadowed}
						onOpen={onOpen}
						value={
							editable ? (
								<IconTooltip label="Edit">
									<button
										type="button"
										data-testid="codex-setting-change"
										aria-label={`Edit ${setting.key}`}
										onClick={() =>
											setComposing({
												key: setting.key,
												keyPath: setting.keyPath,
												value: setting.value,
											})
										}
										className="min-w-0 flex-1 text-left tr-code-text text-primary hover:underline"
									>
										<span className="line-clamp-4 break-all">{display(setting.value)}</span>
									</button>
								</IconTooltip>
							) : (
								<span
									title={display(setting.value)}
									className="line-clamp-4 min-w-0 flex-1 break-all tr-code-text text-primary"
								>
									{display(setting.value)}
								</span>
							)
						}
						actions={
							setting.scope === "system" ? null : (
								<>
									{shapeOf(setting.value) === null ? (
										<span className="shrink-0 tr-text-label-pill text-text-subtle uppercase">
											edit as a file
										</span>
									) : null}
									<RowAction
										testid="codex-setting-remove"
										label="Remove"
										tone="danger"
										onClick={() =>
											onSave(
												setting.scope === "project" ? "project" : "user",
												setting.keyPath,
												null,
											)
										}
									/>
								</>
							)
						}
					/>
				);
			})}
			{shown.length === 0 ? <p className="p-8 tr-text-ui text-text-muted">No keys match.</p> : null}
		</div>
	);
}
