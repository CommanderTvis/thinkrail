import { RiAddLine as Plus } from "@remixicon/react";
import type { ClaudeSettingValue } from "@thinkrail/contracts";
import { useState } from "react";
import { IconTooltip } from "@/components/ui/tooltip";
import {
	type EditRequest,
	type OpenSource,
	RowAction,
	ScopeChip,
	SourceButton,
} from "./ClaudeConfigParts";
import { ClaudeValueDialog, shapeOf } from "./ClaudeValueDialog";

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

			<div className="flex items-center gap-8 border-border-default border-b bg-control-bg pr-8">
				<input
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Filter keys…"
					aria-label="Filter settings keys"
					className="min-w-0 flex-1 bg-transparent px-8 py-4 tr-text-ui text-text-default outline-none placeholder:text-text-subtle"
				/>
				<button
					type="button"
					data-testid="claude-setting-add"
					onClick={() => setComposing({ key: "", value: undefined })}
					className="flex shrink-0 items-center gap-4 rounded-[var(--radius-sm)] border border-border-default px-8 py-2 tr-text-label-pill text-text-muted uppercase hover:bg-control-bg-hovered hover:text-text-default"
				>
					<Plus className="size-12" /> Add a setting
				</button>
			</div>
			<div className="min-h-0 flex-1 overflow-auto">
				{shown.map((entry) => (
					<div
						key={entry.key}
						data-testid="claude-setting"
						data-key={entry.key}
						className="border-border-muted border-b px-8 py-4"
					>
						<div className="flex items-start gap-4">
							{entry.docsUrl ? (
								<a
									href={entry.docsUrl}
									target="_blank"
									rel="noreferrer"
									data-testid="claude-setting-docs"
									title="What this key does, in Claude Code's reference"
									className="min-w-0 flex-1 break-words tr-code-text text-text-default hover:text-primary hover:underline"
								>
									{entry.key}
								</a>
							) : (
								<span className="min-w-0 flex-1 break-words tr-code-text text-text-default">
									{entry.key}
								</span>
							)}
							<ScopeChip scope={entry.origin.scope} />
						</div>
						{/* A value can be a 150-rule allow list; wrapped in full it would bury every key
						    below it, so it clamps. The value is the control: clicking it is how you change it,
						    which is where a reader's eye already is. */}
						<div className="flex items-start gap-4">
							{shapeOf(entry.value) === null ? (
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
										{/* The clamp lives on a span: line-clamp needs -webkit-box display, which a
										    button element silently refuses — the 150-rule allow list came back. */}
										<span className="line-clamp-4 break-all">{JSON.stringify(entry.value)}</span>
									</button>
								</IconTooltip>
							)}
						</div>
						<div className="flex items-center gap-4 py-2">
							{entry.origin.path ? (
								<SourceButton
									path={entry.origin.path}
									keyPath={entry.origin.keyPath}
									onOpen={onOpen}
								/>
							) : null}
							<span className="flex-1" />
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
						</div>
						{entry.shadowed.map((shadow) => (
							<div
								key={`${entry.key}:${shadow.origin.scope}`}
								data-testid="claude-setting-shadowed"
								className="mt-2 flex items-center gap-4 pl-8"
							>
								<span
									title={JSON.stringify(shadow.value)}
									className="line-clamp-2 min-w-0 flex-1 break-all tr-code-text text-text-subtle line-through"
								>
									{JSON.stringify(shadow.value)}
								</span>
								<ScopeChip scope={shadow.origin.scope} />
							</div>
						))}
					</div>
				))}
				{shown.length === 0 ? (
					<p className="p-8 tr-text-ui text-text-muted">No keys match.</p>
				) : null}
			</div>
		</div>
	);
}
