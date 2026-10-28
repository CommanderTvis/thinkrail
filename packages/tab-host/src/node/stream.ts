import { EventEmitter } from "events";

function unsupported(): never {
	throw new Error("Node streams are not available in the ThinkRail Playground");
}

export class Readable extends EventEmitter {
	constructor() {
		super();
		unsupported();
	}
}

export class Writable extends EventEmitter {
	constructor() {
		super();
		unsupported();
	}
}
