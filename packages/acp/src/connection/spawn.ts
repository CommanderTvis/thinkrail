import { fileSinkWritable } from "./stdioFraming";
import type { ProcessSpawner } from "./types";

export const spawnWithBun: ProcessSpawner = (launch) => {
	const child = Bun.spawn<"pipe", "pipe", "pipe">([launch.command, ...launch.args], {
		...(launch.cwd !== undefined ? { cwd: launch.cwd } : {}),
		...(launch.env !== undefined ? { env: { ...Bun.env, ...launch.env } } : {}),
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		stdin: fileSinkWritable(child.stdin),
		stdout: child.stdout,
		stderr: child.stderr,
		exited: child.exited.then(() => ({ code: child.exitCode, signal: child.signalCode })),
		kill: (signal) => {
			child.kill(signal);
		},
	};
};
