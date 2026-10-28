import { RiKeyLine as KeyRound, RiLoginBoxLine as LogIn } from "@remixicon/react";
import type { ProviderStatus } from "@thinkrail/contracts";
import { T, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { AnthropicCreditsLink } from "./AnthropicCreditsLink";
import { GoogleCreditsLink } from "./GoogleCreditsLink";

export function ProviderRow({
	provider,
	busy,
	onSignIn,
	onApiKey,
}: {
	provider: ProviderStatus;
	busy: boolean;
	onSignIn: () => void;
	onApiKey: () => void;
}) {
	const t = useT();
	return (
		<div
			data-testid="provider-signin-row"
			data-provider={provider.id}
			data-configured="false"
			className="flex items-center gap-8 border-border-muted border-b py-12"
		>
			<span className="flex min-w-0 flex-1 flex-col gap-2">
				<span className="truncate tr-text-ui text-text-default">{provider.name}</span>
				{provider.id === "anthropic" ? (
					<span data-testid="anthropic-credits-hint" className="tr-text-metadata text-text-muted">
						<T
							i18nKey="settings.providers.anthropicCredits"
							components={[<AnthropicCreditsLink key="claim" />]}
						/>
					</span>
				) : provider.id === "google" ? (
					<span data-testid="google-credits-hint" className="tr-text-metadata text-text-muted">
						<T
							i18nKey="settings.providers.googleCredits"
							components={[<GoogleCreditsLink key="activate" />]}
						/>
					</span>
				) : null}
			</span>
			<div className="flex shrink-0 items-center gap-4">
				{provider.canOAuth && (
					<Button
						variant="soft-primary"
						size="m"
						iconLeft={LogIn}
						data-testid="provider-signin"
						data-provider={provider.id}
						disabled={busy}
						onClick={onSignIn}
					>
						{t("settings.providers.signIn")}
					</Button>
				)}
				{provider.canApiKey && (
					<Button
						variant="outline"
						size="m"
						iconLeft={KeyRound}
						data-testid="provider-apikey"
						data-provider={provider.id}
						disabled={busy}
						onClick={onApiKey}
					>
						{t("settings.providers.apiKey")}
					</Button>
				)}
			</div>
		</div>
	);
}
