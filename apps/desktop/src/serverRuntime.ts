export interface DesktopHostOptions {
	runtimeDir: string;
	staticDir: string;
	appVersion: string;
	channel: string;
	/** The port this profile listened on last time; taken when free, searched upward when not. */
	port?: number | undefined;
}

export interface DesktopHost {
	server: {
		readonly port: number;
		stop(): void;
		shutdown(): Promise<void>;
	};
	port: number;
	requested: number;
}

export interface DesktopServerRuntime {
	startDesktopHost(options: DesktopHostOptions): Promise<DesktopHost>;
}
