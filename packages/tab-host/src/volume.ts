import { createTabFs } from "./fs";

/** The one volume a tab host runs on; `node:fs` resolves to it inside the tab-host worker. */
export const tabVolume = createTabFs();
