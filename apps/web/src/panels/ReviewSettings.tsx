import { cn } from "@/lib";
import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";

export function ReviewSettings() {
	const autoFix = useAppStore((s) => s.reviewAutoFix);
	const toggleAutoFix = () => {
		getTransport()
			.request("settings.update", { config: { reviewAutoFix: !autoFix } })
			.catch(() => toast.error("Couldn't change the auto-fix setting"));
	};

	return (
		<section data-testid="settings-review" className="flex flex-col gap-16">
			<div className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">Automatic fix cycle</h3>
				<p className="text-text-muted tr-text-metadata">
					When on, a “changes requested” verdict is sent to the worker chat automatically (once) and
					the fix is re-reviewed without asking. When off, the reviewer only records its findings
					and waits for you.
				</p>
			</div>
			<div className="flex items-center justify-between gap-12 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-12 py-8">
				<div className="flex flex-col gap-2">
					<span className="tr-title-compact text-text-default">Auto-fix requested changes</span>
					<span className="text-text-muted tr-text-metadata">
						{autoFix
							? "On — the reviewer's findings are auto-sent to the worker and re-reviewed once."
							: "Off — findings wait for you; nothing is auto-sent."}
					</span>
				</div>
				<button
					type="button"
					role="switch"
					aria-checked={autoFix}
					aria-label="Auto-fix requested changes"
					data-testid="review-autofix-toggle"
					data-active={autoFix}
					onClick={toggleAutoFix}
					className={cn(
						"relative h-20 w-36 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
						autoFix ? "bg-primary" : "bg-border-default",
					)}
				>
					<span
						className={cn(
							"absolute top-2 left-2 size-16 rounded-full bg-container-workspace-bg transition-transform",
							autoFix && "translate-x-16",
						)}
					/>
				</button>
			</div>
		</section>
	);
}
