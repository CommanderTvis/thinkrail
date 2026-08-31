import type {
	FixtureTranscript,
	FixtureTranscriptResult,
} from "@thinkrail/server/transcript-test-fixtures";
import { writeFixtureTranscript } from "@thinkrail/server/transcript-test-fixtures";
import { E2E_DATA_DIR } from "./paths";

export function seedTranscript(input: FixtureTranscript): Promise<FixtureTranscriptResult> {
	return writeFixtureTranscript(E2E_DATA_DIR, input);
}
