import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";

export function EditorSettings() {
	const wordWrap = useAppStore((s) => s.editorWordWrap);

	return (
		<section data-testid="settings-editor" className="flex flex-col gap-8">
			<div className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">Word wrap</h3>
				<p className="text-text-muted tr-text-metadata">
					Soft-wrap long lines instead of scrolling sideways. Prose is unreadable without it; for
					code most editors leave it off.
				</p>
			</div>
			<label className="flex w-full items-center gap-8 tr-text-ui text-text-default">
				<input
					type="checkbox"
					data-testid="editor-word-wrap"
					checked={wordWrap}
					onChange={(event) =>
						getTransport()
							.request("settings.update", { config: { editorWordWrap: event.target.checked } })
							.catch(() => toast.error("Couldn't change word wrap"))
					}
					className="size-16 shrink-0 accent-primary"
				/>
				<span className="min-w-0 flex-1">Wrap long lines in the editor</span>
			</label>
		</section>
	);
}
