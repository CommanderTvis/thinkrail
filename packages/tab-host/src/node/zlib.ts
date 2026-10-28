function unavailable(): never {
	throw new Error("gzip is not available in the ThinkRail Playground");
}

export const constants = {};
export const gzipSync = unavailable;
export const gunzipSync = unavailable;
