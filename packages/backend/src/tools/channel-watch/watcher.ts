import { type FSWatcher, watch } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "../../log";

const log = createLogger("channel-watch-watcher");

export interface ChannelWatchEvent {
	topic: string;

	relPath: string;
}

export type WatcherMode = "idle" | "watch" | "poll";

export interface ChannelWatcherOptions {
	channelRoot: string;
	onEvent: (event: ChannelWatchEvent) => void;

	debounceMs?: number;

	pollIntervalMs?: number;
}

export function parseWatchFilename(filename: string | Buffer | null): ChannelWatchEvent | null {
	if (!filename) return null;
	const rel = filename.toString();
	if (rel.length === 0) return null;
	const segments = rel.split(/[\\/]/).filter((s) => s.length > 0);
	if (segments.length === 0) return null;
	const topic = segments[0];
	if (!topic || topic.startsWith(".")) return null;

	const last = segments[segments.length - 1] ?? topic;
	if (last.startsWith(".")) return null;
	return { topic, relPath: segments.join("/") };
}

export class ChannelWatcher {
	private readonly root: string;
	private readonly onEvent: (event: ChannelWatchEvent) => void;
	private readonly debounceMs: number;
	private readonly pollIntervalMs: number;
	private fsWatcher: FSWatcher | null = null;
	private pollTimer: NodeJS.Timeout | null = null;
	private pollSnapshot: Map<string, string> | null = null;
	private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
	private _mode: WatcherMode = "idle";

	constructor(options: ChannelWatcherOptions) {
		this.root = options.channelRoot;
		this.onEvent = options.onEvent;
		this.debounceMs = options.debounceMs ?? 3000;
		this.pollIntervalMs = options.pollIntervalMs ?? 5000;
	}

	get mode(): WatcherMode {
		return this._mode;
	}

	async start(): Promise<WatcherMode> {
		if (this._mode !== "idle") return this._mode;
		try {
			this.fsWatcher = watch(this.root, { recursive: true }, (_eventType, filename) => {
				const parsed = parseWatchFilename(filename);
				if (parsed) this.scheduleDebounced(parsed);
			});
			this.fsWatcher.on("error", (err) => {
				log.warn("fs.watch 错误，转降级轮询", { error: err instanceof Error ? err.message : String(err) });
				this.stopFswatch();
				void this.startPolling();
			});
			this._mode = "watch";
			log.info("channel watcher 启动（fs.watch recursive）", { root: this.root });
			return this._mode;
		} catch (err) {
			log.warn("fs.watch 不可用，降级轮询", {
				root: this.root,
				error: err instanceof Error ? err.message : String(err),
			});
			return this.startPolling();
		}
	}

	private stopFswatch(): void {
		if (this.fsWatcher) {
			this.fsWatcher.close();
			this.fsWatcher = null;
		}
	}

	private async startPolling(): Promise<WatcherMode> {
		if (this.pollTimer) return this._mode;
		this.pollSnapshot = await this.scanSnapshot();
		this.pollTimer = setInterval(() => {
			void this.pollTick();
		}, this.pollIntervalMs);

		this.pollTimer.unref?.();
		this._mode = "poll";
		log.info("channel watcher 启动（降级轮询）", { root: this.root, interval: this.pollIntervalMs });
		return this._mode;
	}

	private async scanSnapshot(): Promise<Map<string, string>> {
		const snapshot = new Map<string, string>();
		try {
			const topics = await readdir(this.root, { withFileTypes: true });
			for (const topicEntry of topics) {
				if (!topicEntry.isDirectory() || topicEntry.name.startsWith(".")) continue;
				const files = await readdir(join(this.root, topicEntry.name), { withFileTypes: true });
				for (const file of files) {
					if (!file.isFile() || file.name.startsWith(".")) continue;
					const relPath = `${topicEntry.name}/${file.name}`;
					try {
						const st = await stat(join(this.root, relPath));
						snapshot.set(relPath, `${st.mtimeMs}:${st.size}`);
					} catch {}
				}
			}
		} catch {}
		return snapshot;
	}

	private async pollTick(): Promise<void> {
		const prev = this.pollSnapshot;
		if (!prev) return;
		const next = await this.scanSnapshot();
		this.pollSnapshot = next;
		for (const [relPath, sig] of next) {
			if (prev.get(relPath) !== sig) {
				const parsed = parseWatchFilename(relPath);
				if (parsed) this.onEvent(parsed);
			}
		}
	}

	private scheduleDebounced(event: ChannelWatchEvent): void {
		const existing = this.debounceTimers.get(event.relPath);
		if (existing) clearTimeout(existing);
		const timer = setTimeout(() => {
			this.debounceTimers.delete(event.relPath);
			this.onEvent(event);
		}, this.debounceMs);
		timer.unref?.();
		this.debounceTimers.set(event.relPath, timer);
	}

	stop(): void {
		this.stopFswatch();
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		this.pollSnapshot = null;
		for (const t of this.debounceTimers.values()) clearTimeout(t);
		this.debounceTimers.clear();
		this._mode = "idle";
	}
}
