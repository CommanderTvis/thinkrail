import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { E2E_PLUGIN_DIR } from "./paths";

/** The checked-in external plugin fixture — see e2e/plugins/fixture and e2e/SPEC.md. */
export const E2E_FIXTURE_PLUGIN_DIR = join(E2E_PLUGIN_DIR, "e2e-fixture");

const SOURCE_DIR = join(import.meta.dirname, "plugin-fixture");

/** Stages the checked-in fixture plugin into this lane's isolated plugin root. */
export function seedPluginFixture(): void {
	rmSync(E2E_PLUGIN_DIR, { recursive: true, force: true });
	mkdirSync(E2E_PLUGIN_DIR, { recursive: true });
	cpSync(SOURCE_DIR, E2E_FIXTURE_PLUGIN_DIR, { recursive: true });
}
