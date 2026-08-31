import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	connectJbcentral,
	disconnectJbcentral,
	getJbcentralStatus,
	isJbcentralUsable,
	jbcentralLogin,
	resetJbcentralStateForTests,
	setJbcentralChangedPublisher,
	startJbcentralWatch,
	startProxyJbcentral,
	updateJbcentral,
} from "./jbcentral";

describe("isJbcentralUsable", () => {
	test("is true only for a signed-in configured proxy", () => {
		expect(isJbcentralUsable({ state: "absent" })).toBe(false);
		expect(isJbcentralUsable({ state: "outdated", version: "1.0" })).toBe(false);
		expect(isJbcentralUsable({ state: "supported", version: "1.0", signedOut: false })).toBe(false);
		expect(
			isJbcentralUsable({
				state: "configured",
				version: "1.0",
				signedOut: true,
				proxyStopped: false,
			}),
		).toBe(false);
		expect(
			isJbcentralUsable({
				state: "configured",
				version: "1.0",
				signedOut: false,
				proxyStopped: false,
			}),
		).toBe(true);
	});
});

const syntheticExtension = "export default function syntheticCentralExtension() {}\n";

const fakeCentral = `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$THINKRAIL_CENTRAL_TEST_LOG"
case "$1" in
  --version)
    if [ -f "$THINKRAIL_CENTRAL_TEST_CONTROL/malformed" ]; then
      printf 'synthetic-sensitive-version-output\\n'
    elif [ -f "$THINKRAIL_CENTRAL_TEST_CONTROL/outdated" ]; then
      printf 'central 1.3.9 (independently-authored test metadata)\\n'
    elif [ -f "$THINKRAIL_CENTRAL_TEST_CONTROL/newer" ]; then
      printf 'central 1.7.0 (independently-authored test metadata)\\n'
    else
      printf 'central 1.6.2 (independently-authored test metadata)\\n'
    fi
    ;;
  status)
    while [ -f "$THINKRAIL_CENTRAL_TEST_CONTROL/status-wait" ]; do sleep 0.01; done
    if [ -f "$THINKRAIL_CENTRAL_TEST_CONTROL/signed-out" ]; then
      printf '\\033[1mAuth      \\033[m \\033[1mnot connected\\033[m\\n'
    else
      printf '\\033[1mAuth      \\033[m \\033[1mSynthetic Access\\033[m\\n'
    fi
    if [ -f "$THINKRAIL_CENTRAL_TEST_CONTROL/proxy-stopped" ]; then
      printf '\\033[1mProxy     \\033[m \\033[1mstopped\\033[m\\n'
    else
      printf '\\033[1mProxy     \\033[m \\033[1mrunning on port 19516\\033[m\\n'
    fi
    printf 'synthetic-sensitive-child-output\\n'
    ;;
  add)
    if [ -f "$THINKRAIL_CENTRAL_TEST_CONTROL/add-fail" ]; then
      printf 'synthetic-sensitive-child-output\\n' >&2
      exit 9
    fi
    while [ -f "$THINKRAIL_CENTRAL_TEST_CONTROL/add-wait" ]; do sleep 0.01; done
    mkdir -p "$HOME/.pi/agent/extensions"
    cp "$THINKRAIL_CENTRAL_TEST_EXTENSION_SOURCE" "$HOME/.pi/agent/extensions/jetbrains-central.ts"
    ;;
  remove)
    rm -f "$HOME/.pi/agent/extensions/jetbrains-central.ts"
    ;;
  update)
    rm -f "$THINKRAIL_CENTRAL_TEST_CONTROL/outdated"
    ;;
  proxy)
    [ "$2" = "start" ]
    [ "$3" = "--ensure-updated" ]
    if [ -f "$THINKRAIL_CENTRAL_TEST_CONTROL/proxy-start-fail" ]; then exit 9; fi
    while [ -f "$THINKRAIL_CENTRAL_TEST_CONTROL/proxy-start-wait" ]; do sleep 0.01; done
    if [ ! -f "$THINKRAIL_CENTRAL_TEST_CONTROL/proxy-stays-stopped" ]; then
      rm -f "$THINKRAIL_CENTRAL_TEST_CONTROL/proxy-stopped"
    fi
    ;;
  login)
    ;;
  *)
    exit 8
    ;;
esac
`;

let root: string;
let home: string;
let controlDir: string;
let logPath: string;
let extensionSource: string;
let artifactPath: string;
let priorEnv: Record<string, string | undefined>;

function control(name: string, present: boolean): void {
	const path = join(controlDir, name);
	if (present) writeFileSync(path, "1\n");
	else rmSync(path, { force: true });
}

function probeCount(): number {
	return commandLog().filter((invocation) => invocation === "status").length;
}

function commandLog(): string[] {
	if (!existsSync(logPath)) return [];
	return readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
}

async function pollStatus(state: string): Promise<void> {
	for (let attempt = 0; attempt < 300; attempt += 1) {
		if ((await getJbcentralStatus()).state === state) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`Central status did not reach ${state}`);
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
	for (let attempt = 0; attempt < 300; attempt += 1) {
		if (await predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("condition was not reached");
}

beforeEach(async () => {
	priorEnv = {
		HOME: process.env.HOME,
		PATH: process.env.PATH,
		THINKRAIL_CENTRAL_TEST_LOG: process.env.THINKRAIL_CENTRAL_TEST_LOG,
		THINKRAIL_CENTRAL_TEST_CONTROL: process.env.THINKRAIL_CENTRAL_TEST_CONTROL,
		THINKRAIL_CENTRAL_TEST_EXTENSION_SOURCE: process.env.THINKRAIL_CENTRAL_TEST_EXTENSION_SOURCE,
	};
	await resetJbcentralStateForTests();

	root = mkdtempSync(join(tmpdir(), "thinkrail-central-auth-"));
	home = join(root, "home");
	controlDir = join(root, "control");
	logPath = join(root, "central.log");
	extensionSource = join(root, "synthetic-central.ts");
	artifactPath = join(home, ".pi", "agent", "extensions", "jetbrains-central.ts");
	const binDir = join(root, "bin");
	mkdirSync(binDir, { recursive: true });
	mkdirSync(home, { recursive: true });
	mkdirSync(controlDir, { recursive: true });
	writeFileSync(extensionSource, syntheticExtension);
	writeFileSync(join(binDir, "central"), fakeCentral);
	chmodSync(join(binDir, "central"), 0o755);

	process.env.HOME = home;
	process.env.PATH = `${binDir}:${priorEnv.PATH ?? ""}`;
	process.env.THINKRAIL_CENTRAL_TEST_LOG = logPath;
	process.env.THINKRAIL_CENTRAL_TEST_CONTROL = controlDir;
	process.env.THINKRAIL_CENTRAL_TEST_EXTENSION_SOURCE = extensionSource;
	startJbcentralWatch();
});

afterEach(async () => {
	await resetJbcentralStateForTests();
	for (const [name, value] of Object.entries(priorEnv)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	rmSync(root, { recursive: true, force: true });
});

describe("native Central orchestration", () => {
	test("connect writes the global opaque artifact the pi agent loads", async () => {
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		expect(existsSync(artifactPath)).toBe(true);
		expect((await getJbcentralStatus()).state).toBe("configured");
		expect(commandLog()).toContain("add pi");
	});

	test("disconnect removes the artifact and reports the plain state", async () => {
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		expect(await disconnectJbcentral()).toEqual({ outcome: "applied" });
		expect(existsSync(artifactPath)).toBe(false);
		expect((await getJbcentralStatus()).state).toBe("supported");
	});

	test("an already-absent artifact is the complete Disconnect postcondition", async () => {
		expect(await disconnectJbcentral()).toEqual({ outcome: "applied" });
		expect(commandLog()).not.toContain("remove pi");
	});

	test("an out-of-band artifact change moves the status and invalidates open cards", async () => {
		control("signed-out", true);
		let invalidations = 0;
		setJbcentralChangedPublisher(() => {
			invalidations += 1;
		});

		mkdirSync(join(home, ".pi", "agent", "extensions"), { recursive: true });
		writeFileSync(artifactPath, syntheticExtension);
		await waitFor(async () => {
			const status = await getJbcentralStatus();
			return status.state === "configured" && status.signedOut;
		});
		await waitFor(() => invalidations >= 2);

		const settled = invalidations;
		rmSync(artifactPath);
		await pollStatus("supported");
		await waitFor(() => invalidations > settled);
	});

	test("single-flights in-app actions and publishes closed invalidations", async () => {
		control("add-wait", true);
		let invalidations = 0;
		setJbcentralChangedPublisher(() => {
			invalidations += 1;
		});
		const first = connectJbcentral();
		const second = connectJbcentral();
		expect(first).toBe(second);
		await waitFor(() => commandLog().includes("add pi"));
		control("add-wait", false);
		expect(await first).toEqual({ outcome: "applied" });
		expect(commandLog().filter((line) => line === "add pi")).toHaveLength(1);
		expect(invalidations).toBeGreaterThan(0);
	});

	test("regenerates an existing artifact after updating Central", async () => {
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		control("outdated", true);
		expect(await updateJbcentral()).toEqual({ outcome: "applied" });
		const actions = commandLog().filter((invocation) => invocation !== "--version");
		expect(actions.slice(-2)).toEqual(["update --install", "add pi"]);
		expect((await getJbcentralStatus()).state).toBe("configured");
	});

	test("reports a signed-out Central off the read path, without exposing the probe's output", async () => {
		control("signed-out", true);
		expect(await getJbcentralStatus()).toEqual({
			state: "supported",
			version: "1.6.2",
			signedOut: false,
		});
		await waitFor(async () => {
			const status = await getJbcentralStatus();
			return status.state === "supported" && status.signedOut;
		});
		expect(commandLog()).toContain("status");
		expect(JSON.stringify(await getJbcentralStatus())).not.toContain(
			"synthetic-sensitive-child-output",
		);

		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		expect(await getJbcentralStatus()).toEqual({
			state: "configured",
			version: "1.6.2",
			signedOut: true,
			proxyStopped: false,
		});
	});

	test("reports and starts a positively stopped proxy", async () => {
		control("proxy-stopped", true);
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		await waitFor(async () => {
			const status = await getJbcentralStatus();
			return status.state === "configured" && status.proxyStopped;
		});

		expect(await startProxyJbcentral()).toEqual({ outcome: "applied" });
		expect(commandLog()).toContain("proxy start --ensure-updated");
		expect(await getJbcentralStatus()).toEqual({
			state: "configured",
			version: "1.6.2",
			signedOut: false,
			proxyStopped: false,
		});
	});

	test("keeps Start proxy single-flighted and closed when the proxy remains stopped", async () => {
		control("proxy-stopped", true);
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		control("proxy-start-wait", true);
		control("proxy-stays-stopped", true);
		const first = startProxyJbcentral();
		const second = startProxyJbcentral();
		expect(first).toBe(second);
		await waitFor(() => commandLog().includes("proxy start --ensure-updated"));
		control("proxy-start-wait", false);
		expect(await first).toEqual({ outcome: "failed", reason: "central-action-failed" });
		expect(commandLog().filter((line) => line === "proxy start --ensure-updated")).toHaveLength(1);
		await waitFor(async () => {
			const status = await getJbcentralStatus();
			return status.state === "configured" && status.proxyStopped;
		});
	});

	test("Start proxy is refused while Central is not configured", async () => {
		expect(await startProxyJbcentral()).toEqual({
			outcome: "failed",
			reason: "central-action-failed",
		});
		expect(commandLog()).not.toContain("proxy start --ensure-updated");
	});

	test("collapses a burst of status reads into a single status probe", async () => {
		await getJbcentralStatus();
		await waitFor(() => probeCount() >= 1);
		const settled = probeCount();
		for (let read = 0; read < 6; read += 1) await getJbcentralStatus();
		expect(probeCount()).toBe(settled);
	});

	test("never probes Central status while an action is in flight", async () => {
		await getJbcentralStatus();
		await waitFor(() => probeCount() >= 1);
		expect(await jbcentralLogin()).toEqual({ outcome: "launched" });

		control("add-wait", true);
		const connect = connectJbcentral();
		await waitFor(() => commandLog().includes("add pi"));
		const duringAction = probeCount();
		for (let poll = 0; poll < 6; poll += 1) {
			expect((await getJbcentralStatus()).state).toBe("configuring");
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		expect(probeCount()).toBe(duringAction);

		control("add-wait", false);
		expect(await connect).toEqual({ outcome: "applied" });
		await waitFor(async () => {
			await getJbcentralStatus();
			return probeCount() > duringAction;
		});
	});

	test("an invalidation that overtakes an in-flight probe discards its answer", async () => {
		control("status-wait", true);
		control("signed-out", true);
		await getJbcentralStatus();
		await waitFor(() => probeCount() >= 1);

		control("signed-out", false);
		expect(await jbcentralLogin()).toEqual({ outcome: "launched" });
		control("status-wait", false);

		const started = Date.now();
		let reprobed = false;
		while (Date.now() - started < 1_500) {
			await getJbcentralStatus();
			if (probeCount() >= 2) {
				reprobed = true;
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		expect(reprobed).toBe(true);
		await waitFor(async () => {
			const status = await getJbcentralStatus();
			return status.state === "supported" && !status.signedOut;
		});
	});

	test("launching sign-in invalidates the cached verdict so the next read re-probes", async () => {
		control("signed-out", true);
		await waitFor(async () => {
			const status = await getJbcentralStatus();
			return status.state === "supported" && status.signedOut;
		});
		const probes = probeCount();

		control("signed-out", false);
		expect(await jbcentralLogin()).toEqual({ outcome: "launched" });
		await waitFor(async () => {
			const status = await getJbcentralStatus();
			return status.state === "supported" && !status.signedOut;
		});
		expect(probeCount()).toBeGreaterThan(probes);
	});

	test("treats a version above the minimum as supported", async () => {
		control("newer", true);
		expect((await getJbcentralStatus()).state).toBe("supported");
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		expect((await getJbcentralStatus()).state).toBe("configured");
	});

	test("keeps version/login/update outcomes closed", async () => {
		control("malformed", true);
		expect(await jbcentralLogin()).toEqual({ outcome: "failed", reason: "unsupported-version" });
		expect(await updateJbcentral()).toEqual({ outcome: "failed", reason: "unsupported-version" });
		control("malformed", false);
		control("outdated", true);
		expect(await updateJbcentral()).toEqual({ outcome: "applied" });
		expect(commandLog()).toContain("update --install");

		control("add-fail", true);
		const failed = await connectJbcentral();
		expect(failed).toEqual({ outcome: "failed", reason: "central-action-failed" });
		expect(JSON.stringify(failed)).not.toContain("synthetic-sensitive-child-output");
	});
});
