export interface CodexCommandIo {
	write: (data: string) => void;
	delay: (ms: number) => Promise<void>;
}

export async function submitCodexCommand(io: CodexCommandIo, command: string): Promise<void> {
	io.write(command);
	await io.delay(250);
	io.write("\r");
}
