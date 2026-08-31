import type {
	JbcentralAction,
	JbcentralActionFailureReason,
	JbcentralActionResult,
	JbcentralConnectResult,
	JbcentralLoginResult,
	JbcentralStatus,
} from "@thinkrail/contracts";
import {
	type JbcentralActionResult as CliActionResult,
	inspectJbcentral,
	JBCENTRAL_STATUS_TTL_MS,
	type JbcentralInspection,
	type JbcentralStatusObservation,
	launchJbcentralLogin,
	probeJbcentralStatus,
	runJbcentralAction,
	watchJbcentralArtifact,
} from "@thinkrail/shared/jbcentral";

const INVALIDATION_DEBOUNCE_MS = 75;

const STATUS_TTL_MS = JBCENTRAL_STATUS_TTL_MS;

let statusObservation: JbcentralStatusObservation = { auth: "unknown", proxy: "unknown" };
let statusProbedAt = 0;
let statusGeneration = 0;
let statusTask: Promise<void> | null = null;
let transientAction: JbcentralAction | null = null;
let watching = false;
let stopped = false;
let stopArtifactWatcher: (() => void) | null = null;
let invalidationTimer: ReturnType<typeof setTimeout> | null = null;

let actionTail = Promise.resolve();
const actionFlights = new Map<JbcentralAction, Promise<JbcentralActionResult>>();
let loginTask: Promise<JbcentralLoginResult> | null = null;
let publishApplied: () => void = () => {};
let publishChanged: () => void = () => {};

export function setJbcentralAppliedPublisher(publisher: () => void): void {
	publishApplied = publisher;
}

export function setJbcentralChangedPublisher(publisher: () => void): void {
	publishChanged = publisher;
}

function failed(reason: JbcentralActionFailureReason): JbcentralActionResult {
	return { outcome: "failed", reason };
}

function inspectionConfigured(inspection: JbcentralInspection): boolean {
	return inspection.status.state === "supported" && inspection.status.configured;
}

function mapInspectionStatus(inspection: JbcentralInspection): JbcentralStatus {
	switch (inspection.status.state) {
		case "absent":
			return { state: "absent" };
		case "outdated":
			return { state: "outdated", version: inspection.status.version };
		case "malformed-version":
			return { state: "malformed-version" };
		case "probe-failed":
			return { state: "probe-failed", reason: inspection.status.reason };
		case "supported": {
			const signedOut = statusObservation.auth === "signed-out";
			return inspection.status.configured
				? {
						state: "configured",
						version: inspection.status.version,
						signedOut,
						proxyStopped: statusObservation.proxy === "stopped",
					}
				: { state: "supported", version: inspection.status.version, signedOut };
		}
	}
}

function invalidateStatusObservation(): void {
	statusProbedAt = 0;
	statusGeneration += 1;
}

function sameStatusObservation(
	left: JbcentralStatusObservation,
	right: JbcentralStatusObservation,
): boolean {
	return left.auth === right.auth && left.proxy === right.proxy;
}

function applyStatusObservation(observation: JbcentralStatusObservation): void {
	statusProbedAt = Date.now();
	if (sameStatusObservation(observation, statusObservation)) return;
	statusObservation = observation;
	publishChanged();
}

function refreshStatusIfStale(): void {
	if (stopped || statusTask || Date.now() - statusProbedAt < STATUS_TTL_MS) return;
	const generation = statusGeneration;
	const task = (async () => {
		const observation = await probeJbcentralStatus();
		if (stopped || generation !== statusGeneration) return;
		applyStatusObservation(observation);
	})();
	statusTask = task;
	void task
		.catch(() => {})
		.finally(() => {
			if (statusTask === task) statusTask = null;
		});
}

function scheduleInvalidation(): void {
	if (stopped || invalidationTimer !== null) return;
	invalidationTimer = setTimeout(() => {
		invalidationTimer = null;
		if (!stopped) publishChanged();
	}, INVALIDATION_DEBOUNCE_MS);
}

function inspectionFailure(inspection: JbcentralInspection): JbcentralActionResult | null {
	switch (inspection.status.state) {
		case "absent":
			return failed("not-installed");
		case "outdated":
		case "malformed-version":
			return failed("unsupported-version");
		case "probe-failed":
			return failed("version-probe-failed");
		case "supported":
			return null;
	}
}

function mapCliFailure(result: CliActionResult): JbcentralActionFailureReason | null {
	if (result.outcome === "succeeded") return null;
	switch (result.reason) {
		case "not-installed":
			return "not-installed";
		case "artifact-missing":
			return "artifact-missing";
		case "artifact-present":
			return "artifact-present";
		default:
			return "central-action-failed";
	}
}

export function startJbcentralWatch(): void {
	if (watching || stopped) return;
	watching = true;
	stopArtifactWatcher = watchJbcentralArtifact(scheduleInvalidation);
}

export function stopJbcentralWatch(): void {
	stopped = true;
	watching = false;
	stopArtifactWatcher?.();
	stopArtifactWatcher = null;
	if (invalidationTimer !== null) clearTimeout(invalidationTimer);
	invalidationTimer = null;
}

export async function getJbcentralStatus(): Promise<JbcentralStatus> {
	startJbcentralWatch();
	if (transientAction !== null) return { state: "configuring", action: transientAction };

	const inspection = await inspectJbcentral();
	if (inspection.status.state === "supported") refreshStatusIfStale();
	return mapInspectionStatus(inspection);
}

export function isJbcentralUsable(status: JbcentralStatus): boolean {
	return status.state === "configured" && !status.signedOut;
}

async function connect(): Promise<JbcentralActionResult> {
	transientAction = "connect";
	publishChanged();
	try {
		const inspection = await inspectJbcentral();
		const preflightFailure = inspectionFailure(inspection);
		if (preflightFailure) return preflightFailure;
		const actionFailure = mapCliFailure(await runJbcentralAction("add"));
		if (actionFailure) {
			invalidateStatusObservation();
			return failed(actionFailure);
		}
		publishApplied();
		return { outcome: "applied" };
	} finally {
		transientAction = null;
		publishChanged();
	}
}

async function disconnect(): Promise<JbcentralActionResult> {
	transientAction = "disconnect";
	publishChanged();
	try {
		const inspection = await inspectJbcentral();
		if (!inspection.artifactExists) return { outcome: "applied" };
		const preflightFailure = inspectionFailure(inspection);
		if (preflightFailure) return preflightFailure;
		const actionFailure = mapCliFailure(await runJbcentralAction("remove"));
		return actionFailure ? failed(actionFailure) : { outcome: "applied" };
	} finally {
		transientAction = null;
		publishChanged();
	}
}

async function startProxy(): Promise<JbcentralActionResult> {
	transientAction = "start-proxy";
	publishChanged();
	try {
		const inspection = await inspectJbcentral();
		const preflightFailure = inspectionFailure(inspection);
		if (preflightFailure) return preflightFailure;
		if (!inspectionConfigured(inspection)) return failed("central-action-failed");

		const result = await runJbcentralAction("start-proxy");
		invalidateStatusObservation();
		const actionFailure = mapCliFailure(result);
		if (actionFailure) return failed(actionFailure);
		if (result.outcome === "succeeded" && result.observation) {
			applyStatusObservation(result.observation);
		}
		return { outcome: "applied" };
	} finally {
		transientAction = null;
		publishChanged();
	}
}

async function update(): Promise<JbcentralActionResult> {
	transientAction = "update";
	publishChanged();
	try {
		const before = await inspectJbcentral();
		if (before.status.state === "supported") return { outcome: "applied" };
		if (before.status.state !== "outdated") {
			return inspectionFailure(before) ?? failed("unsupported-version");
		}

		const updateFailure = mapCliFailure(await runJbcentralAction("update"));
		if (updateFailure) return failed(updateFailure);
		const afterUpdate = await inspectJbcentral();
		const postflightFailure = inspectionFailure(afterUpdate);
		if (postflightFailure) return postflightFailure;

		if (before.artifactExists) {
			const addFailure = mapCliFailure(await runJbcentralAction("add"));
			if (addFailure) return failed(addFailure);
		}
		return { outcome: "applied" };
	} finally {
		transientAction = null;
		publishChanged();
	}
}

function scheduleAction(
	action: JbcentralAction,
	operation: () => Promise<JbcentralActionResult>,
): Promise<JbcentralActionResult> {
	const existing = actionFlights.get(action);
	if (existing) return existing;

	const task = actionTail
		.then(operation)
		.catch((): JbcentralActionResult => failed("central-action-failed"));
	actionFlights.set(action, task);
	actionTail = task.then(() => undefined);
	void task.finally(() => {
		if (actionFlights.get(action) === task) actionFlights.delete(action);
	});
	return task;
}

export function connectJbcentral(): Promise<JbcentralConnectResult> {
	return scheduleAction("connect", connect);
}

export function disconnectJbcentral(): Promise<JbcentralActionResult> {
	return scheduleAction("disconnect", disconnect);
}

export function startProxyJbcentral(): Promise<JbcentralActionResult> {
	return scheduleAction("start-proxy", startProxy);
}

export function updateJbcentral(): Promise<JbcentralActionResult> {
	return scheduleAction("update", update);
}

export function jbcentralLogin(): Promise<JbcentralLoginResult> {
	if (loginTask) return loginTask;
	const task = actionTail
		.then(async (): Promise<JbcentralLoginResult> => {
			const inspection = await inspectJbcentral();
			switch (inspection.status.state) {
				case "absent":
					return { outcome: "failed", reason: "not-installed" };
				case "outdated":
				case "malformed-version":
					return { outcome: "failed", reason: "unsupported-version" };
				case "probe-failed":
					return { outcome: "failed", reason: "version-probe-failed" };
				case "supported":
					invalidateStatusObservation();
					return await launchJbcentralLogin();
			}
		})
		.catch((): JbcentralLoginResult => ({ outcome: "failed", reason: "launch-failed" }));
	loginTask = task;
	actionTail = task.then(() => undefined);
	void task.finally(() => {
		if (loginTask === task) loginTask = null;
	});
	return task;
}

export async function resetJbcentralStateForTests(): Promise<void> {
	stopJbcentralWatch();
	await Promise.allSettled([actionTail, statusTask]);
	statusObservation = { auth: "unknown", proxy: "unknown" };
	statusProbedAt = 0;
	statusGeneration = 0;
	statusTask = null;
	transientAction = null;
	watching = false;
	stopped = false;
	actionTail = Promise.resolve();
	actionFlights.clear();
	loginTask = null;
	publishApplied = () => {};
	publishChanged = () => {};
}
