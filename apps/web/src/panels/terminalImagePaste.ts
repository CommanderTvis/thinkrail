import { TERMINAL_IMAGE_MAX_BYTES } from "@thinkrail/contracts";
import { shellQuotePath } from "@/lib";

export function installTerminalImagePaste(
	host: HTMLElement,
	options: {
		id(): string | null;
		bracketed(): boolean;
		save(id: string, data: string, mimeType: string): Promise<{ path: string }>;
		write(id: string, data: string): void;
		error(message: string | null): void;
	},
) {
	let disposed = false;
	let generation = 0;
	let running = false;
	const queue: Array<() => Promise<void> | void> = [];
	const drain = async () => {
		if (running) return;
		running = true;
		const version = generation;
		try {
			while (!disposed && generation === version && queue.length) await queue.shift()?.();
		} catch (cause) {
			if (disposed || generation !== version) return;
			queue.length = 0;
			options.error(
				`Couldn't paste image: ${cause instanceof Error ? cause.message : String(cause)} Queued input was not sent.`,
			);
		} finally {
			if (generation === version) running = false;
		}
	};
	const send = (id: string, data: string) => {
		if (!disposed && options.id() === id) options.write(id, data);
	};
	const paste = (event: ClipboardEvent) => {
		const files = Array.from(event.clipboardData?.items ?? [])
			.filter((item) => item.kind === "file" && item.type.startsWith("image/"))
			.map((item) => item.getAsFile())
			.filter((file): file is File => file !== null);
		if (!files.length) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		const id = options.id();
		if (!id) return;
		options.error(null);
		const version = generation;
		queue.push(async () => {
			for (const file of files) {
				if (disposed || generation !== version || options.id() !== id) return;
				if (file.size > TERMINAL_IMAGE_MAX_BYTES) throw new Error("Images must be at most 10 MiB.");
				if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type))
					throw new Error("Use PNG, JPEG, GIF, or WebP.");
				const data = await new Promise<string>((resolve, reject) => {
					const reader = new FileReader();
					reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
					reader.onerror = () => reject(new Error("Could not read the clipboard image."));
					reader.readAsDataURL(file);
				});
				if (disposed || generation !== version || options.id() !== id) return;
				const { path } = await options.save(id, data, file.type);
				if (disposed || generation !== version || options.id() !== id) return;
				const text = `${shellQuotePath(path)} `;
				send(id, options.bracketed() ? `\x1b[200~${text}\x1b[201~` : text);
			}
		});
		void drain();
	};
	host.addEventListener("paste", paste, true);
	return {
		write(data: string) {
			const id = options.id();
			if (!id) return;
			if (running) queue.push(() => send(id, data));
			else send(id, data);
		},
		cancel() {
			generation += 1;
			running = false;
			queue.length = 0;
		},
		dispose() {
			disposed = true;
			queue.length = 0;
			host.removeEventListener("paste", paste, true);
		},
	};
}
