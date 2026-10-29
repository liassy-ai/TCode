import { appendFile, mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createLogger } from "../log";

const log = createLogger("trace");

const FLUSH_INTERVAL_MS = 500;
const FLUSH_BATCH_SIZE = 128;

const ROTATE_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_ARCHIVED = 5;

const MAX_EVENT_BYTES = 512 * 1024;

const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

export interface TraceLimits {
	flushIntervalMs?: number;
	rotateSizeBytes?: number;
	maxEventBytes?: number;
	maxBufferBytes?: number;
}

export class TraceRecorder {
	private readonly buffer: string[] = [];
	private bufferBytes = 0;
	private readonly timer: NodeJS.Timeout;
	private closed = false;
	private flushing = false;

	private sizeBytes = 0;

	private constructor(
		private readonly filePath: string,
		private readonly sessionId: string,
		private readonly limits: Required<
			Pick<TraceLimits, "rotateSizeBytes" | "maxEventBytes" | "maxBufferBytes">
		>,
		flushIntervalMs: number,
	) {
		this.timer = setInterval(() => this.flush(), flushIntervalMs);
		this.timer.unref();
	}

	static async create(sessionDir: string, sessionId: string, limits?: TraceLimits): Promise<TraceRecorder> {
		const dir = join(sessionDir, "traces");
		await mkdir(dir, { recursive: true });
		const filePath = join(dir, `trace-${sessionId}.jsonl`);
		const resolved = {
			rotateSizeBytes: limits?.rotateSizeBytes ?? ROTATE_SIZE_BYTES,
			maxEventBytes: limits?.maxEventBytes ?? MAX_EVENT_BYTES,
			maxBufferBytes: limits?.maxBufferBytes ?? MAX_BUFFER_BYTES,
		};
		await rotateIfLarge(filePath, dir, sessionId, resolved.rotateSizeBytes);
		await sweepArchived(dir, sessionId);
		const recorder = new TraceRecorder(
			filePath,
			sessionId,
			resolved,
			limits?.flushIntervalMs ?? FLUSH_INTERVAL_MS,
		);
		recorder.sizeBytes = await stat(filePath)
			.then((s) => s.size)
			.catch(() => 0);
		log.debug("trace started", filePath);
		return recorder;
	}

	static async removeAll(sessionDir: string, sessionId: string): Promise<void> {
		const dir = join(sessionDir, "traces");
		let files: string[];
		try {
			files = await readdir(dir);
		} catch {
			return;
		}
		const prefix = `trace-${sessionId}`;
		for (const file of files) {
			if (!file.startsWith(prefix) || !file.endsWith(".jsonl")) continue;
			await unlink(join(dir, file)).catch(() => {});
		}
	}

	record(event: unknown): void {
		if (this.closed) return;
		let line: string;
		try {
			line =
				event !== null && typeof event === "object"
					? JSON.stringify({ ts: Date.now(), ...(event as object) })
					: (JSON.stringify(event) ?? "null");
		} catch (err) {
			log.warn("trace serialize failed", this.filePath, err);
			return;
		}
		if (line.length > this.limits.maxEventBytes) {
			const originalType = JSON.stringify((event as { type?: unknown })?.type ?? "unknown");
			line = `{"ts":${Date.now()},"_truncated":true,"type":"trace_gap","originalType":${originalType},"bytes":${line.length}}`;
		}
		this.buffer.push(line);
		this.bufferBytes += line.length;
		this.compactBuffer();
		if (this.buffer.length >= FLUSH_BATCH_SIZE) void this.flush();
	}

	async close(): Promise<void> {
		this.closed = true;
		clearInterval(this.timer);

		while (this.flushing) await new Promise((resolve) => setTimeout(resolve, 5));
		await this.flush();
	}

	private async flush(): Promise<void> {
		if (this.flushing || this.buffer.length === 0) return;
		this.flushing = true;
		let chunk: string;
		try {
			chunk = `${this.buffer.join("\n")}\n`;
		} catch (err) {
			log.error("trace flush join failed, batch dropped", this.filePath, err);
			chunk = `{"ts":${Date.now()},"_truncated":true,"type":"trace_gap","reason":"flush_join_failed"}\n`;
		}
		this.buffer.length = 0;
		this.bufferBytes = 0;
		try {
			await appendFile(this.filePath, chunk, "utf-8");
			this.sizeBytes += Buffer.byteLength(chunk, "utf-8");

			if (this.sizeBytes >= this.limits.rotateSizeBytes) await this.rotateNow();
		} catch (err) {
			log.error("trace write failed", this.filePath, err);
		} finally {
			this.flushing = false;
		}
	}

	private async rotateNow(): Promise<void> {
		try {
			const dir = dirname(this.filePath);
			const ts = new Date().toISOString().replace(/[:.]/g, "-");
			await rename(this.filePath, join(dir, `trace-${this.sessionId}.${ts}.jsonl`));
			this.sizeBytes = 0;
			await sweepArchived(dir, this.sessionId);
		} catch (err) {
			log.warn("trace rotate failed", this.filePath, err);
		}
	}

	private compactBuffer(): void {
		if (this.bufferBytes <= this.limits.maxBufferBytes || this.buffer.length === 0) return;
		let dropped = 0;
		while (this.bufferBytes > this.limits.maxBufferBytes && this.buffer.length > 1) {
			const line = this.buffer.shift();
			if (line === undefined) break;
			this.bufferBytes -= line.length;
			dropped++;
		}
		const marker = `{"ts":${Date.now()},"_truncated":true,"type":"trace_gap","reason":"buffer_overflow","dropped":${dropped}}`;
		this.buffer.unshift(marker);
		this.bufferBytes += marker.length;
	}
}

async function rotateIfLarge(
	filePath: string,
	dir: string,
	sessionId: string,
	maxBytes: number,
): Promise<void> {
	try {
		const { size } = await stat(filePath);
		if (size < maxBytes) return;
		const ts = new Date().toISOString().replace(/[:.]/g, "-");
		await rename(filePath, join(dir, `trace-${sessionId}.${ts}.jsonl`));
	} catch {}
}

async function sweepArchived(dir: string, sessionId: string): Promise<void> {
	const prefix = `trace-${sessionId}.`;
	try {
		const files = (
			await Promise.all(
				(
					await readdir(dir)
				)
					.filter((f) => f !== `trace-${sessionId}.jsonl` && f.startsWith(prefix) && f.endsWith(".jsonl"))
					.map(async (f) => {
						const path = join(dir, f);
						const { mtime } = await stat(path);
						return { path, mtime: mtime.getTime() };
					}),
			)
		).sort((a, b) => b.mtime - a.mtime);
		for (const file of files.slice(MAX_ARCHIVED)) {
			await unlink(file.path).catch(() => {});
		}
	} catch {}
}
