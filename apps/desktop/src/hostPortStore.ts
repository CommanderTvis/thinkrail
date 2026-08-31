import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const PORT_VERSION = 1;
const MIN_PORT = 1024;
const MAX_PORT = 65535;

interface PortDocument {
	version: 1;
	ports: Record<string, number>;
}

function validPort(value: unknown): value is number {
	return (
		typeof value === "number" && Number.isInteger(value) && value >= MIN_PORT && value <= MAX_PORT
	);
}

function readDocument(path: string): PortDocument {
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (
			typeof value !== "object" ||
			value === null ||
			Reflect.get(value, "version") !== PORT_VERSION ||
			typeof Reflect.get(value, "ports") !== "object" ||
			Reflect.get(value, "ports") === null
		) {
			return { version: PORT_VERSION, ports: {} };
		}
		const ports: Record<string, number> = {};
		for (const [key, port] of Object.entries(
			Reflect.get(value, "ports") as Record<string, unknown>,
		)) {
			if (validPort(port)) ports[key] = port;
		}
		return { version: PORT_VERSION, ports };
	} catch {
		return { version: PORT_VERSION, ports: {} };
	}
}

/** The port a backend profile listened on last time, so the window comes back to the same origin. */
export class HostPortStore {
	readonly #path: string;
	readonly #document: PortDocument;

	constructor(path: string) {
		this.#path = path;
		this.#document = existsSync(path) ? readDocument(path) : { version: PORT_VERSION, ports: {} };
	}

	read(backendProfileId: string): number | undefined {
		return this.#document.ports[backendProfileId];
	}

	write(backendProfileId: string, port: unknown): boolean {
		if (!validPort(port)) return false;
		if (this.#document.ports[backendProfileId] === port) return true;
		this.#document.ports[backendProfileId] = port;
		mkdirSync(dirname(this.#path), { recursive: true });
		writeFileSync(this.#path, `${JSON.stringify(this.#document, null, "\t")}\n`);
		return true;
	}
}
