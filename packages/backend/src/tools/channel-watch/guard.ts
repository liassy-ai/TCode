import { createHash } from "node:crypto";
import { createLogger } from "../../log";

const log = createLogger("channel-watch-guard");

export const SELF_WRITE_WINDOW_MS = 10_000;

export const PINGPONG_WINDOW_MS = 10 * 60_000;

export const PINGPONG_MAX_WAKES = 6;

export interface DeliverDecision {
	deliver: boolean;

	reason: "ok" | "self-write" | "hash-unchanged" | "paused";
}

export interface LoopGuardOptions {
	now?: () => number;
}

export function contentHash(content: string): string {
	if (content.length === 0) return "empty";
	return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}

export class LoopGuard {
	private readonly now: () => number;

	private readonly selfWrites = new Map<string, number>();

	private readonly deliveredHashes = new Map<string, string>();

	private readonly wakeHistory = new Map<string, number[]>();

	private readonly pausedTopics = new Map<string, number>();

	constructor(options: LoopGuardOptions = {}) {
		this.now = options.now ?? Date.now;
	}

	markSelfWrite(absPath: string): void {
		this.selfWrites.set(absPath, this.now());

		if (this.selfWrites.size > 1000) {
			const cutoff = this.now() - SELF_WRITE_WINDOW_MS;
			for (const [p, t] of this.selfWrites) {
				if (t < cutoff) this.selfWrites.delete(p);
			}
		}
	}

	isSelfWrite(absPath: string): boolean {
		const at = this.now();
		for (const [p, t] of this.selfWrites) {
			if (at - t >= SELF_WRITE_WINDOW_MS) continue;

			if (p === absPath || absPath.startsWith(`${p}/`)) return true;
		}
		return false;
	}

	private hashKey(topic: string, relPath: string): string {
		return `${topic}/${relPath}`;
	}

	shouldDeliver(topic: string, relPath: string, currentHash: string, absPath?: string): DeliverDecision {
		if (this.pausedTopics.has(topic)) return { deliver: false, reason: "paused" };
		if (absPath && this.isSelfWrite(absPath)) return { deliver: false, reason: "self-write" };
		const prev = this.deliveredHashes.get(this.hashKey(topic, relPath));
		if (prev !== undefined && prev === currentHash) {
			return { deliver: false, reason: "hash-unchanged" };
		}
		return { deliver: true, reason: "ok" };
	}

	recordDelivered(topic: string, relPath: string, hash: string): boolean {
		this.deliveredHashes.set(this.hashKey(topic, relPath), hash);
		return this.recordWake(topic);
	}

	recordWake(topic: string): boolean {
		const at = this.now();
		const history = (this.wakeHistory.get(topic) ?? []).filter((t) => at - t < PINGPONG_WINDOW_MS);
		history.push(at);
		this.wakeHistory.set(topic, history);
		if (history.length >= PINGPONG_MAX_WAKES) {
			this.pausedTopics.set(topic, at);
			this.wakeHistory.delete(topic);
			log.warn("channel-watch 乒乓上限触发，暂停频道投递", { topic, wakes: history.length });
			return true;
		}
		return false;
	}

	noteUserMessage(): void {
		if (this.wakeHistory.size > 0) this.wakeHistory.clear();
	}

	isPaused(topic: string): boolean {
		return this.pausedTopics.has(topic);
	}

	pausedTopicList(): Array<{ topic: string; since: number }> {
		return [...this.pausedTopics.entries()].map(([topic, since]) => ({ topic, since }));
	}

	resumeTopic(topic: string): void {
		this.pausedTopics.delete(topic);
		this.wakeHistory.delete(topic);
	}

	forgetTopic(topic: string): void {
		this.pausedTopics.delete(topic);
		this.wakeHistory.delete(topic);
		const prefix = `${topic}/`;
		for (const key of this.deliveredHashes.keys()) {
			if (key.startsWith(prefix)) this.deliveredHashes.delete(key);
		}
	}

	reset(): void {
		this.selfWrites.clear();
		this.deliveredHashes.clear();
		this.wakeHistory.clear();
		this.pausedTopics.clear();
	}
}
