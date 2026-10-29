export class Emitter<T> {
	private readonly handlers = new Set<(payload: T) => void>();

	subscribe(handler: (payload: T) => void): () => void {
		this.handlers.add(handler);
		return () => {
			this.handlers.delete(handler);
		};
	}

	emit(payload: T): void {
		for (const handler of this.handlers) {
			try {
				handler(payload);
			} catch {}
		}
	}

	get size(): number {
		return this.handlers.size;
	}

	clear(): void {
		this.handlers.clear();
	}
}
