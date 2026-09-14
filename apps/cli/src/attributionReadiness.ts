export async function openUiThenStartAttribution(
	enabled: boolean,
	url: string,
	openBrowser: (url: string) => void,
	startAttributionClaim: () => void,
	hasClient: () => Promise<boolean>,
): Promise<void> {
	if (!enabled) return;
	if (!(await hasClient())) openBrowser(url);
	startAttributionClaim();
}
