import { type TerminalTabInfo, WS_CHANNELS } from "@thinkrail/contracts";
import type { Bash } from "just-bash/browser";

const REPLAY_LIMIT = 64 * 1024;
const HISTORY_LIMIT = 200;

export interface TerminalHost {
	publish(channel: string, data: unknown): void;
	/** A fresh shell rooted at the workspace, and the root the prompt is shown relative to. */
	shell(workspaceId: string): { bash: Bash; root: string; name: string };
	/** Called after each command, which may have changed files or git state. */
	commandRan(workspaceId: string): void;
}

interface Session {
	id: string;
	workspaceId: string;
	bash: Bash;
	root: string;
	name: string;
	cwd: string;
	env: Record<string, string>;
	line: string;
	history: string[];
	historyIndex: number;
	running: boolean;
	replay: string;
}

interface Tab {
	info: TerminalTabInfo;
	session?: Session;
}

const crlf = (text: string) => text.replace(/\r?\n/g, "\r\n");

/**
 * Terminals for a host in a browser tab: a line editor in front of just-bash, one shell per tab, its
 * working directory and exports carried from one command to the next.
 */
export class TabTerminals {
	private readonly tabs = new Map<string, Map<string, Tab>>();
	private readonly sessions = new Map<string, Session>();
	private seq = 0;

	constructor(private readonly host: TerminalHost) {}

	private workspaceTabs(workspaceId: string): Map<string, Tab> {
		let tabs = this.tabs.get(workspaceId);
		if (!tabs) {
			tabs = new Map();
			this.tabs.set(workspaceId, tabs);
		}
		return tabs;
	}

	private publishTabs(workspaceId: string): void {
		this.host.publish(WS_CHANNELS.terminalTabs, { workspaceId, tabs: this.list(workspaceId) });
	}

	list(workspaceId: string): TerminalTabInfo[] {
		return [...this.workspaceTabs(workspaceId).values()].map((tab) => tab.info);
	}

	reserve(workspaceId: string, tabKey: string, title: string): TerminalTabInfo {
		const tabs = this.workspaceTabs(workspaceId);
		const existing = tabs.get(tabKey);
		if (existing) return existing.info;
		const info = { tabKey, title };
		tabs.set(tabKey, { info });
		this.publishTabs(workspaceId);
		return info;
	}

	attach(workspaceId: string, tabKey: string, title?: string) {
		const tab = this.workspaceTabs(workspaceId).get(tabKey) ?? {
			info: this.reserve(workspaceId, tabKey, title ?? "Terminal"),
		};
		this.workspaceTabs(workspaceId).set(tabKey, tab);
		if (tab.session) return { id: tab.session.id, created: false, replay: tab.session.replay };
		const { bash, root, name } = this.host.shell(workspaceId);
		const session: Session = {
			id: `tabterm_${++this.seq}`,
			workspaceId,
			bash,
			root,
			name,
			cwd: root,
			env: { HOME: root, PWD: root, USER: "thinkrail", TERM: "xterm-256color" },
			line: "",
			history: [],
			historyIndex: 0,
			running: false,
			replay: "",
		};
		tab.session = session;
		this.sessions.set(session.id, session);
		this.output(
			session,
			"\x1b[2mThinkRail Playground shell (simulated): coreutils, rg, jq, and git (pull, push, commit, …). Type `help` for more.\x1b[0m\r\n",
		);
		this.prompt(session);
		return { id: session.id, created: true, replay: session.replay };
	}

	rename(workspaceId: string, tabKey: string, title: string): void {
		const tab = this.workspaceTabs(workspaceId).get(tabKey);
		if (!tab) return;
		tab.info = { ...tab.info, title };
		this.publishTabs(workspaceId);
	}

	close(workspaceId: string, tabKey: string) {
		const tabs = this.workspaceTabs(workspaceId);
		const tab = tabs.get(tabKey);
		if (tab?.session) this.sessions.delete(tab.session.id);
		tabs.delete(tabKey);
		this.publishTabs(workspaceId);
		return { closed: true, busy: false };
	}

	private output(session: Session, data: string): void {
		session.replay = (session.replay + data).slice(-REPLAY_LIMIT);
		this.host.publish(WS_CHANNELS.terminalData, { id: session.id, data });
	}

	private prompt(session: Session): void {
		const relative =
			session.cwd === session.root
				? "~"
				: session.cwd.startsWith(`${session.root}/`)
					? `~/${session.cwd.slice(session.root.length + 1)}`
					: session.cwd;
		this.output(session, `\x1b[32m${session.name}\x1b[0m:\x1b[34m${relative}\x1b[0m$ `);
	}

	private replaceLine(session: Session, next: string): void {
		this.output(session, `${"\b \b".repeat(session.line.length)}${next}`);
		session.line = next;
	}

	write(id: string, data: string): void {
		const session = this.sessions.get(id);
		if (!session || session.running) return;
		for (let i = 0; i < data.length; i++) {
			const char = data[i] ?? "";
			if (char === "\x1b") {
				const sequence = data.slice(i, i + 3);
				if (sequence === "\x1b[A" || sequence === "\x1b[B") {
					const step = sequence === "\x1b[A" ? -1 : 1;
					session.historyIndex = Math.max(
						0,
						Math.min(session.history.length, session.historyIndex + step),
					);
					this.replaceLine(session, session.history[session.historyIndex] ?? "");
				}
				i += 2;
				continue;
			}
			if (char === "\r" || char === "\n") {
				this.output(session, "\r\n");
				void this.run(session, data.slice(i + 1));
				return;
			}
			if (char === "\x7f" || char === "\b") {
				if (session.line.length > 0) {
					session.line = session.line.slice(0, -1);
					this.output(session, "\b \b");
				}
			} else if (char === "\x03") {
				session.line = "";
				this.output(session, "^C\r\n");
				this.prompt(session);
			} else if (char === "\x0c") {
				this.output(session, "\x1b[2J\x1b[H");
				this.prompt(session);
				this.output(session, session.line);
			} else if (char >= " ") {
				session.line += char;
				this.output(session, char);
			}
		}
	}

	private async run(session: Session, pending: string): Promise<void> {
		const command = session.line;
		session.line = "";
		if (command.trim()) {
			session.history = [...session.history.filter((entry) => entry !== command), command].slice(
				-HISTORY_LIMIT,
			);
		}
		session.historyIndex = session.history.length;
		if (command.trim() === "clear") this.output(session, "\x1b[2J\x1b[H");
		else if (command.trim()) {
			session.running = true;
			try {
				const result = await session.bash.exec(command, {
					cwd: session.cwd,
					env: session.env,
					replaceEnv: true,
				});
				if (result.stdout) this.output(session, crlf(result.stdout));
				if (result.stderr) this.output(session, `\x1b[31m${crlf(result.stderr)}\x1b[0m`);
				if ((result.stdout || result.stderr) && !(result.stdout + result.stderr).endsWith("\n"))
					this.output(session, "\r\n");
				session.env = result.env;
				session.cwd = result.env.PWD ?? session.cwd;
			} catch (error) {
				this.output(session, `\x1b[31m${(error as Error).message}\x1b[0m\r\n`);
			} finally {
				session.running = false;
			}
			this.host.commandRan(session.workspaceId);
		}
		this.prompt(session);
		if (pending) this.write(session.id, pending);
	}
}
