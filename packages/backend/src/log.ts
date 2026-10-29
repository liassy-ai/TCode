import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const MAX_LOG_DAYS = 7;

const FLUSH_INTERVAL_MS = 250;

const FLUSH_BATCH_LINES = 64;

const MAX_BUFFER_BYTES = 1024 * 1024;

let minLevel: Level = (process.env.PI_LOG_LEVEL as Level | undefined) ?? "info";
let logDir: string | undefined = process.env.PI_LOG_DIR;
let logFilePath: string | undefined;

let buffer: string[] = [];
let bufferBytes = 0;
let flushTimer: NodeJS.Timeout | null = null;
let flushing = false;

export function formatTimestamp(d: Date): string {
	const p = (n: number, w = 2): string => String(n).padStart(w, "0");
	const local = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(
		d.getMinutes(),
	)}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
	const offsetMin = d.getTimezoneOffset();
	const sign = offsetMin <= 0 ? "+" : "-";
	const abs = Math.abs(offsetMin);
	return `${local}${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`;
}

export function initLogging(dir?: string, level?: Level): void {
	if (dir) logDir = dir;
	if (level) minLevel = level;
	if (logDir) {
		const date = formatTimestamp(new Date()).slice(0, 10);
		logFilePath = join(logDir, `main-${date}.log`);
		mkdirSync(logDir, { recursive: true });
		sweepOldLogs();

		process.once("exit", flushLogsSync);
	}
}

function sweepOldLogs(): void {
	const dir = logDir;
	if (!dir) return;
	try {
		const cutoff = Date.now() - MAX_LOG_DAYS * 24 * 60 * 60 * 1000;
		for (const file of readdirSync(dir)) {
			if (!/^main-\d{4}-\d{2}-\d{2}\.log$/.test(file)) continue;
			const path = join(dir, file);
			if (statSync(path).mtimeMs < cutoff) unlinkSync(path);
		}
	} catch {}
}

const COLOR: Record<Level, string> = {
	debug: "\x1b[90m",
	info: "\x1b[36m",
	warn: "\x1b[33m",
	error: "\x1b[31m",
};
const RESET = "\x1b[0m";

let stdoutGuardInstalled = false;

function installStdoutGuard(): void {
	if (stdoutGuardInstalled) return;
	stdoutGuardInstalled = true;

	process.stdout?.on?.("error", () => {});
}

function writeStdout(chunk: string): void {
	installStdoutGuard();
	try {
		process.stdout.write(chunk);
	} catch {}
}

function formatArgs(args: unknown[]): string {
	return args
		.map((a) => {
			if (a instanceof Error) return a.stack ?? a.message;
			if (typeof a === "string") return a;
			try {
				return JSON.stringify(a);
			} catch {
				return String(a);
			}
		})
		.join(" ");
}

function compactBuffer(): void {
	if (bufferBytes <= MAX_BUFFER_BYTES || buffer.length === 0) return;
	let dropped = 0;
	while (bufferBytes > MAX_BUFFER_BYTES && buffer.length > 1) {
		const line = buffer.shift();
		if (line === undefined) break;
		bufferBytes -= line.length + 1;
		dropped++;
	}
	const marker = `${formatTimestamp(new Date())} warn  [log] 缓冲超限，丢弃 ${dropped} 行`;
	buffer.unshift(marker);
	bufferBytes += marker.length + 1;
}

function scheduleFlush(): void {
	if (flushTimer !== null) return;
	flushTimer = setTimeout(() => {
		flushTimer = null;
		void flushLogs();
	}, FLUSH_INTERVAL_MS);

	flushTimer.unref?.();
}

export async function flushLogs(): Promise<void> {
	if (flushing || buffer.length === 0 || !logFilePath) return;
	flushing = true;
	const path = logFilePath;
	const chunk = `${buffer.join("\n")}\n`;
	buffer = [];
	bufferBytes = 0;
	try {
		await appendFile(path, chunk, "utf-8");
	} catch {
	} finally {
		flushing = false;
	}
}

export function flushLogsSync(): void {
	if (!logFilePath || buffer.length === 0) return;
	const path = logFilePath;
	const chunk = `${buffer.join("\n")}\n`;
	buffer = [];
	bufferBytes = 0;
	try {
		appendFileSync(path, chunk);
	} catch {}
}

export interface Logger {
	debug(message: string, ...args: unknown[]): void;
	info(message: string, ...args: unknown[]): void;
	warn(message: string, ...args: unknown[]): void;
	error(message: string, ...args: unknown[]): void;
}

installStdoutGuard();

export function createLogger(tag: string): Logger {
	const write = (level: Level, message: string, args: unknown[]) => {
		if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
		const ts = formatTimestamp(new Date());
		const line = `${ts} ${level.padEnd(5)} [${tag}] ${message}${args.length > 0 ? ` ${formatArgs(args)}` : ""}`;
		if (process.stdout.isTTY) {
			writeStdout(`${COLOR[level]}${line}${RESET}\n`);
		} else {
			writeStdout(`${line}\n`);
		}
		if (logFilePath) {
			buffer.push(line);
			bufferBytes += line.length + 1;
			if (bufferBytes > MAX_BUFFER_BYTES) compactBuffer();
			if (buffer.length >= FLUSH_BATCH_LINES) void flushLogs();
			else scheduleFlush();
		}
	};
	return {
		debug: (m, ...a) => write("debug", m, a),
		info: (m, ...a) => write("info", m, a),
		warn: (m, ...a) => write("warn", m, a),
		error: (m, ...a) => write("error", m, a),
	};
}
