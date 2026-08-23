import type { AgentStatusReport, ClaudeCodeStatus } from "@thinkrail/contracts";

// Which statuses are worth interrupting the user for.
const NOTIFY_STATUSES = new Set<ClaudeCodeStatus>(["blocked", "done", "failed"]);

function titleFor(status: ClaudeCodeStatus, project: string | undefined): string {
	const scope = project ? ` — ${project}` : "";
	if (status === "blocked") return `Claude needs you${scope}`;
	if (status === "done") return `Claude finished${scope}`;
	return `Claude hit an error${scope}`;
}

function bodyFor(payload: AgentStatusReport): string {
	return (
		payload.summary ||
		payload.response ||
		payload.query ||
		payload.error_type ||
		"Open the terminal for details."
	);
}

// Fires only when the window is out of view/focus, matching Warp's "away from the terminal" model.
export function notifyClaudeCode(
	status: ClaudeCodeStatus | null,
	payload: AgentStatusReport,
): void {
	if (!status || !NOTIFY_STATUSES.has(status)) return;
	// A status-only event: the turn ended, but something already notified for it.
	if (payload.notify === false) return;
	if (typeof Notification === "undefined") return;
	if (!document.hidden && document.hasFocus()) return;

	const fire = (): void => {
		try {
			const notification = new Notification(titleFor(status, payload.project), {
				body: bodyFor(payload),
				tag: `claude-code:${payload.session_id}`,
			});
			notification.onclick = () => {
				window.focus();
				notification.close();
			};
		} catch {}
	};

	if (Notification.permission === "granted") {
		fire();
	} else if (Notification.permission === "default") {
		void Notification.requestPermission().then((permission) => {
			if (permission === "granted") fire();
		});
	}
}
