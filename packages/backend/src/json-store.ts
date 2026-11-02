import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createLogger } from "./log";

const log = createLogger("json-store");

export type ReadResult<T> = { kind: "ok" | "missing"; value: T } | { kind: "corrupted"; error: unknown };

export class JsonStoreCorruptedError extends Error {
	constructor(
		readonly path: string,
		readonly cause?: unknown,
	) {
		super(`配置文件损坏：${path}，请修复或删除后重试`);
		this.name = "JsonStoreCorruptedError";
	}
}

export interface JsonStoreOptions<T> {
	path: string;

	defaultValue: () => T;

	mode?: number;

	parse?: (raw: string) => T;
}

const queues = new Map<string, Promise<void>>();

function enqueue<T>(path: string, op: () => Promise<T>): Promise<T> {
	const prev = queues.get(path) ?? Promise.resolve();
	const next = prev.then(op, op);
	const settled = next.then(
		() => {},
		() => {},
	);
	queues.set(path, settled);
	void settled.then(() => {
		if (queues.get(path) === settled) queues.delete(path);
	});
	return next;
}

function isEnoent(err: unknown): boolean {
	return typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT";
}

export class JsonStore<T> {
	private readonly path: string;
	private readonly defaultValue: () => T;
	private readonly mode: number | undefined;
	private readonly parse: (raw: string) => T;

	constructor(options: JsonStoreOptions<T>) {
		this.path = options.path;
		this.defaultValue = options.defaultValue;
		this.mode = options.mode;
		this.parse = options.parse ?? (JSON.parse as (raw: string) => T);
	}

	private classify(text: string): ReadResult<T> {
		try {
			return { kind: "ok", value: this.parse(text) };
		} catch (error) {
			return { kind: "corrupted", error };
		}
	}

	private async readRaw(): Promise<ReadResult<T>> {
		let text: string;
		try {
			text = await readFile(this.path, "utf8");
		} catch (err) {
			if (isEnoent(err)) return { kind: "missing", value: this.defaultValue() };
			throw err;
		}
		return this.classify(text);
	}

	private readRawSync(): ReadResult<T> {
		let text: string;
		try {
			text = readFileSync(this.path, "utf8");
		} catch (err) {
			if (isEnoent(err)) return { kind: "missing", value: this.defaultValue() };
			throw err;
		}
		return this.classify(text);
	}

	private async writeInternal(value: T): Promise<void> {
		const dir = dirname(this.path);
		await mkdir(dir, { recursive: true });
		const tmp = join(
			dir,
			`.${basename(this.path)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
		);
		try {
			await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: this.mode });
			await rename(tmp, this.path);
		} catch (err) {
			await rm(tmp, { force: true }).catch(() => {});
			throw err;
		}
	}

	private writeInternalSync(value: T): void {
		const dir = dirname(this.path);
		mkdirSync(dir, { recursive: true });
		const tmp = join(
			dir,
			`.${basename(this.path)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
		);
		try {
			writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: this.mode });
			renameSync(tmp, this.path);
		} catch (err) {
			rmSync(tmp, { force: true });
			throw err;
		}
	}

	async read(): Promise<T> {
		try {
			const result = await this.readRaw();
			if (result.kind === "corrupted") {
				log.warn("json 文件损坏，read 回退默认值", this.path, result.error);
				return this.defaultValue();
			}
			return result.value;
		} catch (err) {
			log.warn("json 文件读取失败，read 回退默认值", this.path, err);
			return this.defaultValue();
		}
	}

	readSync(): T {
		try {
			const result = this.readRawSync();
			if (result.kind === "corrupted") {
				log.warn("json 文件损坏，readSync 回退默认值", this.path, result.error);
				return this.defaultValue();
			}
			return result.value;
		} catch (err) {
			log.warn("json 文件读取失败，readSync 回退默认值", this.path, err);
			return this.defaultValue();
		}
	}

	async update(mutator: (draft: T) => T | void): Promise<T> {
		return enqueue(this.path, async () => {
			const result = await this.readRaw();
			if (result.kind === "corrupted") throw new JsonStoreCorruptedError(this.path, result.error);
			let value = result.value;
			const replacement = mutator(value);
			if (replacement !== undefined) value = replacement;
			await this.writeInternal(value);
			return value;
		});
	}

	updateSync(mutator: (draft: T) => T | void): T {
		const result = this.readRawSync();
		if (result.kind === "corrupted") throw new JsonStoreCorruptedError(this.path, result.error);
		let value = result.value;
		const replacement = mutator(value);
		if (replacement !== undefined) value = replacement;
		this.writeInternalSync(value);
		return value;
	}

	async write(value: T): Promise<void> {
		return enqueue(this.path, () => this.writeInternal(value));
	}

	writeSync(value: T): void {
		this.writeInternalSync(value);
	}
}
