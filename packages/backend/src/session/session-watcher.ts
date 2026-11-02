import { type FSWatcher, watch } from "node:fs";

export class SessionWatcher {
	private readonly watchers: FSWatcher[] = [];
	private timer: NodeJS.Timeout | null = null;
	private closed = false;

	constructor(
		private readonly roots: string[],
		private readonly onChange: () => void,

		private readonly debounceMs = 250,
	) {}

	start(): void {
		for (const root of this.roots) {
			try {
				const watcher = watch(root, { recursive: true }, () => this.schedule());
				watcher.on("error", (error) => {
					if (this.closed) return;
					console.warn("[session-watcher] fs.watch 报错，该根不再监听（不降级轮询）", root, error);
				});
				this.watchers.push(watcher);
			} catch (error) {
				console.warn("[session-watcher] fs.watch recursive 不可用，该根不监听（不降级轮询）", root, error);
			}
		}
	}

	private schedule(): void {
		if (this.closed) return;
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.timer = null;
			if (!this.closed) this.onChange();
		}, this.debounceMs);
	}

	dispose(): void {
		this.closed = true;
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		for (const watcher of this.watchers) watcher.close();
		this.watchers.length = 0;
	}
}
