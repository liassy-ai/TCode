import type { PluginProfile } from "@tcode/shared";

export class ComponentProfileHost {
	private lastKey = "";
	private last: PluginProfile | null = null;
	private emitter: ((p: PluginProfile) => void) | null = null;

	getLast(): PluginProfile | null {
		return this.last;
	}

	setEmitter(fn: (p: PluginProfile) => void): void {
		this.emitter = fn;
	}

	deliver(p: PluginProfile): void {
		let key: string;
		try {
			key = JSON.stringify(p ?? null);
		} catch {
			return;
		}
		if (key === this.lastKey) return;
		this.lastKey = key;
		this.last = p;
		this.emitter?.(p);
	}

	stop(): void {
		this.lastKey = "";
	}
}
