import type { AppConfig } from "@thinkrail/contracts";
import { activate, deactivate } from "./activation";
import type { PluginRegistry } from "./registry";
import type { PluginHostSeams } from "./seams";

function computeDesired(
	registry: PluginRegistry,
	order: readonly string[],
	config: AppConfig,
): Map<string, boolean> {
	const desired = new Map<string, boolean>();
	for (const id of order) {
		const entry = registry.get(id);
		if (!entry || entry.state === "refused") {
			desired.set(id, false);
			continue;
		}
		const explicit = config.plugins[id]?.enabled;
		const base = explicit ?? (entry.origin === "builtin" ? entry.manifest.enabledByDefault : false);
		const depsOk = entry.manifest.dependsOn.every((dep) => {
			const depEntry = registry.get(dep.id);
			return (
				depEntry !== undefined &&
				depEntry.state !== "failed" &&
				depEntry.state !== "refused" &&
				(desired.get(dep.id) ?? false)
			);
		});
		desired.set(id, base && depsOk);
	}
	return desired;
}

export class PluginReconciler {
	private currentRun: Promise<void> | null = null;
	private pending = false;

	constructor(
		private readonly registry: PluginRegistry,
		private readonly seams: PluginHostSeams,
	) {}

	schedule(): Promise<void> {
		if (this.currentRun) {
			this.pending = true;
			return this.currentRun;
		}
		const run = this.run().finally(() => {
			if (this.currentRun === run) this.currentRun = null;
		});
		this.currentRun = run;
		return run;
	}

	private async run(): Promise<void> {
		do {
			this.pending = false;
			await this.runOnce();
		} while (this.pending);
	}

	private async runOnce(): Promise<void> {
		const { order, cycle } = this.registry.topologicalOrder();
		for (const id of cycle) {
			this.registry.setState(id, "refused", "part of a dependency cycle");
			this.seams.publishRoster(this.registry.roster());
		}
		const config = this.seams.config();
		const desired = computeDesired(this.registry, order, config);
		let changed = false;

		for (const id of order) {
			const entry = this.registry.get(id);
			if (!entry) continue;
			if (!desired.get(id) || entry.state === "active" || entry.state === "failed") continue;
			const depsLive = entry.manifest.dependsOn.every(
				(dep) => this.registry.get(dep.id)?.state === "active",
			);
			if (!depsLive) {
				this.registry.setState(id, "failed", "dependency failed during this reconcile pass");
				changed = true;
				this.seams.publishRoster(this.registry.roster());
				continue;
			}
			await activate(id, this.registry, this.seams);
			changed = true;
			this.seams.publishRoster(this.registry.roster());
		}
		for (const id of [...order].reverse()) {
			const entry = this.registry.get(id);
			if (!entry) continue;
			if (!desired.get(id) && entry.state === "active") {
				await deactivate(id, this.registry, this.seams);
				changed = true;
				this.seams.publishRoster(this.registry.roster());
			}
		}
		for (const id of cycle) {
			if (this.registry.get(id)?.state === "active") {
				await deactivate(id, this.registry, this.seams);
				changed = true;
				this.seams.publishRoster(this.registry.roster());
			}
		}

		if (changed) this.seams.resourcesChanged();
	}
}
