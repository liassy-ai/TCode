export class KeyedSingleFlight<T> {
	private readonly inFlight = new Map<string, Promise<T>>();

	get size(): number {
		return this.inFlight.size;
	}

	run(key: string, task: () => Promise<T>): Promise<T> {
		const existing = this.inFlight.get(key);
		if (existing) return existing;
		const promise = task().finally(() => {
			if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
		});
		this.inFlight.set(key, promise);
		return promise;
	}
}
