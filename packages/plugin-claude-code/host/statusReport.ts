import {
	type AgentStatusReport,
	agentEventKnown,
	type ClaudeCodeStatus,
	parseAgentStatusReport,
	statusForAgentEvent,
} from "../contracts";

export interface StatusReportDelivery {
	/** Null for a report that only carries facts — a model switch says nothing about what is happening. */
	status: ClaudeCodeStatus | null;
	report: AgentStatusReport;
}

/**
 * Decide what a POSTed report body means, or refuse it. Pure: the token → terminal resolution happens in
 * `host/index.ts`'s route handler, against `ctx.terminalForToken`, before this is called.
 */
export function parseStatusDelivery(body: unknown): StatusReportDelivery | "unreadable" {
	const report = parseAgentStatusReport(body);
	if (!report) return "unreadable";
	// An event this version does not know moves nothing; a newer hook must not shift a badge by accident.
	if (!agentEventKnown(report.event)) return "unreadable";
	return { status: statusForAgentEvent(report.event), report };
}
