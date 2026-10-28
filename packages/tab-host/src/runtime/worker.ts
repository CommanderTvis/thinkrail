import { type NodeRunRequest, runNode } from "./runtime";

const scope = globalThis as unknown as {
	onmessage: ((event: MessageEvent<NodeRunRequest>) => void) | null;
	postMessage(message: unknown): void;
};

scope.onmessage = (event) => {
	void runNode(event.data).then(
		(result) => scope.postMessage({ result }),
		(error: Error) => scope.postMessage({ error: error.stack ?? error.message }),
	);
};
