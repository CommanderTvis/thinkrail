const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function sameHostByAnotherName(url: URL, origin: URL): boolean {
	return (
		url.protocol === origin.protocol &&
		url.port === origin.port &&
		LOOPBACK_HOSTS.has(url.hostname) &&
		LOOPBACK_HOSTS.has(origin.hostname)
	);
}

export function externalNavigationUrl(value: unknown, origin: string): string | null {
	const raw =
		typeof value === "string"
			? value
			: typeof value === "object" && value !== null && typeof Reflect.get(value, "url") === "string"
				? (Reflect.get(value, "url") as string)
				: null;
	if (!raw) return null;
	try {
		const url = new URL(raw, origin);
		if (url.origin === origin) return null;
		if (sameHostByAnotherName(url, new URL(origin))) return null;
		return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : null;
	} catch {
		return null;
	}
}
