export type UnknownRecord = { readonly [key: string]: unknown };

export function asRecord(value: unknown): UnknownRecord | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	return value as UnknownRecord;
}

export function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

export function asFilledString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

export function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

export function asArray(value: unknown): readonly unknown[] {
	return Array.isArray(value) ? value : [];
}

export function asStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const out: string[] = [];
	for (const entry of value) if (typeof entry === "string") out.push(entry);
	return out;
}

export function asStringRecord(value: unknown): Record<string, string> | undefined {
	const raw = asRecord(value);
	if (raw === undefined) return undefined;
	const out: Record<string, string> = {};
	for (const [key, entry] of Object.entries(raw)) if (typeof entry === "string") out[key] = entry;
	return out;
}

export function asEpochMs(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value !== "string") return undefined;
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? undefined : parsed;
}

export type DeclaredVariants<T extends string> = { readonly [K in T]: unknown };

export function isVariant<T extends string>(
	value: unknown,
	declared: DeclaredVariants<T>,
): value is T {
	return typeof value === "string" && Object.hasOwn(declared, value);
}

export function assertNever(variant: never): never {
	throw new Error(`unhandled variant: ${JSON.stringify(variant)}`);
}

export function unhandledVariant<T>(_variant: never, fallback: T): T {
	return fallback;
}
