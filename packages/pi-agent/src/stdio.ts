import { ndJsonStream } from "@agentclientprotocol/sdk";
import { createPiAgentApp } from "./acp";
import { settleSessionsForShutdown } from "./engine";

function stdoutSink(): WritableStream<Uint8Array> {
	const sink = Bun.stdout.writer();
	return new WritableStream<Uint8Array>({
		write(chunk) {
			sink.write(chunk);
			sink.flush();
		},
		close() {
			sink.end();
		},
		abort() {
			sink.end();
		},
	});
}

export async function runPiAgentOnStdio(): Promise<void> {
	const connection = createPiAgentApp().connect(ndJsonStream(stdoutSink(), Bun.stdin.stream()));
	const close = (): void => connection.close();
	process.on("SIGINT", close);
	process.on("SIGTERM", close);
	try {
		await connection.closed;
	} finally {
		process.off("SIGINT", close);
		process.off("SIGTERM", close);
		await settleSessionsForShutdown();
	}
}
