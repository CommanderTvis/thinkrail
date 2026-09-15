import { RiFolderLine as Folder } from "@remixicon/react";
import { hostWording } from "@/lib/desktopShell";
import { errorText, getTransport } from "@/transport";

const PICK_TIMEOUT_MS = 30 * 60_000;

export function FolderField({
	value,
	placeholder,
	testId,
	onPick,
	onError,
}: {
	value: string | null;
	placeholder: string;
	testId: string;
	onPick: (path: string) => void;
	onError: (message: string | null) => void;
}) {
	const pick = async () => {
		onError(null);
		try {
			const { path } = await getTransport().request(
				"dialog.selectDirectory",
				{},
				{ timeoutMs: PICK_TIMEOUT_MS },
			);
			if (path) onPick(path);
		} catch (err) {
			onError(
				errorText(
					err,
					hostWording(
						"Couldn't open the folder picker on the host.",
						"Couldn't open the folder picker.",
					),
				),
			);
		}
	};

	return (
		<button
			type="button"
			data-testid={testId}
			onClick={() => void pick()}
			className="flex w-full items-center gap-8 rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-12 py-8 text-left hover:bg-control-bg-hovered"
		>
			<Folder className="size-16 shrink-0 text-text-muted" />
			<span className="min-w-0 flex-1 truncate">{value ?? placeholder}</span>
		</button>
	);
}
