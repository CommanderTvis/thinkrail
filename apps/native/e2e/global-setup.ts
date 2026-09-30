import type { FullConfig } from "@playwright/test";
import upstreamSetup from "../../../e2e/global-setup";
import { E2E_PORT } from "../../../e2e/fixtures/paths";
import { nativeAppPath } from "./fixtures/launch";

export default async function globalSetup(config: FullConfig): Promise<void> {
	nativeAppPath();
	await upstreamSetup({
		...config,
		projects: [{ ...config.projects[0], use: { baseURL: `http://localhost:${E2E_PORT}` } }],
	} as FullConfig);
}
