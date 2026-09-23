process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdout.write("fake-review-agent ready\r\n");

let received = "";
process.stdin.on("data", async (chunk: Buffer) => {
	received += chunk.toString();
	if (!received.endsWith("\r")) return;
	process.stdin.pause();
	const bracketed = received.startsWith("\x1b[200~") && received.endsWith("\x1b[201~\r");
	const ids = [...new Set(received.match(/rc_[0-9a-z]+/g) ?? [])];
	process.stdout.write(`paste ${bracketed ? "bracketed" : "raw"}: ${ids.join(",")}\r\n`);
	for (const commentId of ids) {
		const response = await fetch(process.env.THINKRAIL_MCP_URL ?? "", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: "resolve_comment",
					arguments: { commentId, note: "fixed by the fake agent" },
				},
			}),
		});
		const reply = (await response.json()) as { result: { content: { text: string }[] } };
		process.stdout.write(`mcp: ${reply.result.content[0]?.text}\r\n`);
	}
	process.exit(0);
});
