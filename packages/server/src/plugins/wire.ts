import { pluginChannelName } from "@thinkrail/plugin-api";
import type { PluginCall } from "@thinkrail/plugin-api/host";
import { beginCall, endCall, type PluginRegistry, validatePluginParams } from "./registry";
import type { PluginHostSeams } from "./seams";

export function parsePluginMethod(method: string): { id: string; name: string } | null {
	const match = /^plugin\.([a-z0-9-]+)\.(.+)$/.exec(method);
	if (!match) return null;
	const [, id, name] = match;
	if (!id || !name) return null;
	return { id, name };
}

export async function callPluginMethod(
	registry: PluginRegistry,
	id: string,
	name: string,
	params: unknown,
	call: PluginCall,
): Promise<unknown> {
	const entry = registry.get(id);
	if (!entry) throw new Error("Unknown method");
	const contract = entry.module?.contract;
	if (!contract || !(name in contract.methods)) throw new Error("Unknown method");
	if (entry.state !== "active" || !entry.activation) throw new Error(`Plugin ${id} is disabled`);
	const validation = validatePluginParams(contract, name, params);
	if ("error" in validation)
		throw new Error(`Invalid params for plugin.${id}.${name}: ${validation.error}`);
	const handler = entry.activation.methods.get(name);
	if (!handler) throw new Error("Unknown method");
	const tables = entry.activation;
	beginCall(tables);
	try {
		return await handler(params, call);
	} finally {
		endCall(tables);
	}
}

export async function handlePluginRequest(
	registry: PluginRegistry,
	method: string,
	params: unknown,
	call: PluginCall,
): Promise<unknown> {
	const parsed = parsePluginMethod(method);
	if (!parsed) throw new Error("Unknown method");
	return callPluginMethod(registry, parsed.id, parsed.name, params, call);
}

export function publishPlugin(
	registry: PluginRegistry,
	seams: PluginHostSeams,
	id: string,
	channel: string,
	payload: unknown,
	target?: PluginCall,
): void {
	const name = pluginChannelName(id, channel);
	seams.publish(name, payload, target);
	registry.publishLocal(id, name, payload);
}

export function pluginChannelNames(registry: PluginRegistry): string[] {
	const names: string[] = [];
	for (const entry of registry.all()) {
		if (entry.state !== "active" || !entry.module) continue;
		for (const name of Object.keys(entry.module.contract.channels)) {
			names.push(pluginChannelName(entry.manifest.id, name));
		}
	}
	return names;
}
