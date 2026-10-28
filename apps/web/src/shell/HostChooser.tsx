import { RiCloseLine as Close } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { useState } from "react";
import { PRODUCT_NAME } from "../constants/branding";
import {
	type ConnectionStatus,
	connectToHost,
	deletePlaygroundData,
	hostMode,
	hostUrl,
	normalizeHostAddress,
	playgroundOnly,
	switchHostMode,
} from "../transport";

const FIELD_CLASS =
	"w-full rounded-sm border border-control-border-default bg-control-bg px-12 py-8 text-text-default outline-none focus:border-control-border-active";

function shownAddress(): string {
	const url = hostUrl();
	if (!url) return "";
	const parsed = new URL(url);
	return parsed.pathname === "/ws" ? parsed.host : url;
}

/**
 * Where the host runs: a ThinkRail host at an address, or this browser tab. Opened from the topbar's
 * connection status, and in place of home while the page has never reached a host.
 */
export function HostChooser({
	status,
	onClose,
}: {
	status: ConnectionStatus;
	onClose?: () => void;
}) {
	const t = useT();
	const inTab = hostMode() === "tab";
	const [address, setAddress] = useState(shownAddress);
	const [error, setError] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);

	const connect = () => {
		try {
			normalizeHostAddress(address);
		} catch {
			setError(t("shell.hostChooser.invalidAddress"));
			return;
		}
		connectToHost(address);
	};

	return (
		<div
			data-testid="host-chooser"
			className="relative flex h-full min-h-0 flex-col items-center justify-center overflow-auto px-24 py-24"
		>
			{onClose ? (
				<IconButton
					variant="ghost"
					size="m"
					icon={Close}
					label={t("shell.hostChooser.close")}
					data-testid="host-chooser-close"
					onClick={onClose}
					className="absolute top-16 right-16"
				/>
			) : null}
			<div className="flex w-full max-w-[360px] flex-col gap-16">
				<div className="flex flex-col gap-8">
					<h1 className="tr-brand-hero text-primary">{PRODUCT_NAME}</h1>
					<h2 className="tr-title-card text-text-default">{t("shell.hostChooser.title")}</h2>
					<p className="tr-text-metadata text-text-muted">
						{t(
							inTab
								? "shell.hostChooser.inTab"
								: status === "connected"
									? "shell.hostChooser.connected"
									: "shell.hostChooser.disconnected",
						)}
					</p>
				</div>

				{playgroundOnly ? null : (
					<div className="flex flex-col gap-8">
						<span className="tr-text-eyebrow text-text-muted">
							{t("shell.hostChooser.address")}
						</span>
						<input
							data-testid="host-chooser-address"
							value={address}
							placeholder={location.host}
							spellCheck={false}
							onChange={(event) => {
								setAddress(event.target.value);
								setError(null);
							}}
							onKeyDown={(event) => {
								if (event.key === "Enter") connect();
							}}
							className={FIELD_CLASS}
						/>
						{error ? (
							<p data-testid="host-chooser-error" className="tr-text-metadata text-feedback-error">
								{error}
							</p>
						) : null}
						<Button data-testid="host-chooser-connect" onClick={connect}>
							{t("shell.hostChooser.connect")}
						</Button>
					</div>
				)}

				{inTab ? (
					<div data-testid="playground-data" className="flex flex-col gap-8">
						<span className="tr-text-eyebrow text-text-muted">
							{t("shell.playground.dataTitle")}
						</span>
						<p className="tr-text-metadata text-text-muted">
							{t("shell.playground.dataDescription", { origin: location.origin })}
						</p>
						<Button
							variant="outline"
							{...(confirmDelete ? { tone: "danger" as const } : {})}
							data-testid="playground-delete"
							onClick={() => {
								if (confirmDelete) void deletePlaygroundData();
								else setConfirmDelete(true);
							}}
						>
							{t(confirmDelete ? "shell.playground.deleteConfirm" : "shell.playground.delete")}
						</Button>
					</div>
				) : null}

				{inTab ? (
					onClose && !playgroundOnly ? (
						<Button variant="outline" onClick={onClose}>
							{t("shell.hostChooser.keepInTab")}
						</Button>
					) : null
				) : (
					<Button
						variant="outline"
						data-testid="host-chooser-run-in-tab"
						onClick={() => switchHostMode("tab")}
					>
						{t("shell.hostChooser.runInTab")}
					</Button>
				)}
			</div>
		</div>
	);
}
