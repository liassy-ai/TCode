import type { PluginNotify } from "@tcode/shared";

const REPLAYABLE = new Set(["login_state", "gift", "maintenance", "tunnel", "update_state", "update"]);

export class ComponentNotifyHost {
	private state = new Map<string, PluginNotify>();
	private guard: PluginNotify | null = null;
	private emitter: ((n: PluginNotify) => void) | null = null;

	getReplay(): PluginNotify[] {
		const out = [...this.state.values()];
		if (this.guard) out.push(this.guard);
		return out;
	}

	setEmitter(fn: (n: PluginNotify) => void): void {
		this.emitter = fn;
	}

	deliver(n: PluginNotify): void {
		if (REPLAYABLE.has(n.kind)) {
			this.state.delete(n.kind);
			this.state.set(n.kind, n);
		}
		this.emitter?.(n);
	}

	deliverGuard(n: PluginNotify): void {
		if (n.kind === "maintenance") this.guard = n;
		this.emitter?.(n);
	}

	stop(): void {
		this.state.clear();
		this.guard = null;
	}
}
