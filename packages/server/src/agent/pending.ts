interface Waiting<Answer> {
	resolve(answer: Answer): void;
	cancelled: Answer;
}

export class PendingAnswers<Answer> {
	readonly #waiting = new Map<string, Waiting<Answer>>();

	ask(id: string, cancelled: Answer, start: () => void): Promise<Answer> {
		return new Promise<Answer>((resolve) => {
			this.#waiting.set(id, { resolve, cancelled });
			start();
		});
	}

	answer(id: string, answer: Answer): boolean {
		const waiting = this.#waiting.get(id);
		if (waiting === undefined) return false;
		this.#waiting.delete(id);
		waiting.resolve(answer);
		return true;
	}

	cancel(id: string): boolean {
		const waiting = this.#waiting.get(id);
		if (waiting === undefined) return false;
		this.#waiting.delete(id);
		waiting.resolve(waiting.cancelled);
		return true;
	}

	cancelAll(): void {
		for (const id of [...this.#waiting.keys()]) this.cancel(id);
	}
}
