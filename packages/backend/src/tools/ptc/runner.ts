import { Worker } from "node:worker_threads";
import { createLogger } from "../../log";

const log = createLogger("ptc");

const MAX_LOG_BYTES = 128 * 1024;

const MAX_VALUE_BYTES = 512 * 1024;

const MAX_OUTPUT_BYTES = 256 * 1024;

export type PtcFailureKind =
	| "exception"
	| "timeout"
	| "abort"
	| "worker-exit"
	| "invalid-output"
	| "output-limit"
	| "protocol";

export interface PtcRunFailure {
	kind: PtcFailureKind;
	message: string;
}

export interface PtcRunResult {
	ok: boolean;

	value?: unknown;
	logs: string[];
	failure?: PtcRunFailure;
}

export interface PtcRunControl {
	pauseClock(): void;
	resumeClock(): void;
}

export type PtcDispatch = (name: string, args: unknown, control: PtcRunControl) => Promise<unknown>;

export interface RunProgramOptions {
	code: string;
	toolNames: string[];
	cwd: string;
	timeoutMs: number | null;
	signal?: AbortSignal;
	dispatch: PtcDispatch;

	maxOldGenerationMb: number;

	onLog?: (line: string) => void;
}

function describe(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value) ?? "";
	} catch {
		return "";
	}
}

const FAILURE_KINDS: ReadonlySet<string> = new Set([
	"exception",
	"timeout",
	"abort",
	"worker-exit",
	"invalid-output",
	"output-limit",
	"protocol",
]);

function normalizeKind(raw: unknown): PtcFailureKind {
	return typeof raw === "string" && FAILURE_KINDS.has(raw) ? (raw as PtcFailureKind) : "protocol";
}

const BOOTSTRAP = `"use strict";
(function () {
	var workerThreads = require("node:worker_threads");
	var parentPort = workerThreads.parentPort;
	var workerData = workerThreads.workerData || {};
	var runCwd = typeof workerData.cwd === "string" && workerData.cwd ? workerData.cwd : process.cwd();
	try { process.cwd = function () { return runCwd; }; } catch (e) {}
	var MAX_LOG_BYTES = ${MAX_LOG_BYTES};
	var MAX_VALUE_BYTES = ${MAX_VALUE_BYTES};
	var pending = new Map();
	var seq = 0;
	var logs = [];
	var logBytes = 0;
	var started = false;
	var finished = false;
	function byteLength(s) { try { return Buffer.byteLength(s, "utf8"); } catch (e) { return String(s).length; } }
	function stringify(value) {
		if (typeof value === "string") return value;
		try { return JSON.stringify(value); } catch (e) { return String(value); }
	}
	function pushLog(line) {
		var size = byteLength(line) + 1;
		if (logBytes + size > MAX_LOG_BYTES) return;
		logBytes += size;
		logs.push(line);
		send({ t: "log", line: line });
	}
	function consoleMethod() {
		return function () {
			var parts = [];
			for (var i = 0; i < arguments.length; i++) parts.push(stringify(arguments[i]));
			pushLog(parts.join(" "));
		};
	}
	var consoleProxy = {
		log: consoleMethod(), info: consoleMethod(), warn: consoleMethod(),
		error: consoleMethod(), debug: consoleMethod(), trace: consoleMethod()
	};
	function send(message) {
		try { parentPort.postMessage(message); } catch (e) {}
	}
	function toolCallError(tool, message) {
		var err = new Error(message || ("Tool call failed: " + tool));
		err.name = "ToolCallError";
		err.tool = tool;
		return err;
	}
	function describeError(err) {
		if (err && typeof err === "object" && "message" in err) return String(err.message);
		return String(err);
	}
	function finish(ok, value, failureKind, message) {
		if (finished) return;
		finished = true;
		send({ t: "done", ok: ok, value: ok ? value : undefined, logs: logs, failureKind: failureKind, message: message });
	}
	function callTool(name, args) {
		return new Promise(function (resolve, reject) {
			var id = ++seq;
			pending.set(id, { resolve: resolve, reject: reject });
			send({ t: "call", id: id, name: name, args: args === undefined ? null : args });
		});
	}
	function buildTools(names) {
		var callable = {};
		for (var i = 0; i < names.length; i++) {
			(function (name) {
				callable[name] = function () {
					var args = arguments.length <= 1 ? arguments[0] : Array.prototype.slice.call(arguments);
					return callTool(name, args === undefined ? null : args);
				};
			})(names[i]);
		}
		return new Proxy(callable, {
			get: function (target, prop) {
				if (typeof prop === "string" && !(prop in target)) {
					return function () { return Promise.reject(toolCallError(prop, 'Tool "' + prop + '" is not available in this session')); };
				}
				return target[prop];
			}
		});
	}
	function stripTypes(source) {
		try {
			var mod = require("node:module");
			if (mod && typeof mod.stripTypeScriptTypes === "function") {
				return mod.stripTypeScriptTypes(source, { mode: "strip" });
			}
		} catch (e) {}
		return source;
	}
	function makeRequire() {
		try {
			var pathMod = require("node:path");
			var mod = require("node:module");
			return mod.createRequire(pathMod.join(runCwd, "__ptc__.js"));
		} catch (e) { return undefined; }
	}
	function startRun(message) {
		if (started) return;
		started = true;
		var source = stripTypes("(async () => {\\n" + String(message.code || "") + "\\n})");
		var fn;
		try {
			fn = new Function(
				"tools", "console", "process", "require", "module", "exports",
				"globalThis", "global", "Buffer", "__dirname", "__filename", "fetch",
				"return " + source + "();"
			);
		} catch (err) {
			finish(false, undefined, "exception", "程序未能编译（仅支持可擦除 TypeScript）：" + describeError(err));
			return;
		}
		fn(
			buildTools(message.toolNames || []),
			consoleProxy,
			process,
			makeRequire(),
			{ exports: {} },
			{ exports: {} },
			globalThis,
			globalThis,
			Buffer,
			runCwd,
			require("node:path").join(runCwd, "run_code.js"),
			typeof fetch === "function" ? fetch.bind(globalThis) : undefined
		).then(function (value) {
			var serialized;
			try { serialized = JSON.stringify(value === undefined ? null : value); }
			catch (err) { finish(false, undefined, "invalid-output", "返回值无法序列化为 JSON：" + describeError(err)); return; }
			if (serialized !== undefined && byteLength(serialized) > MAX_VALUE_BYTES) {
				finish(false, undefined, "output-limit", "返回值序列化后超过上限（" + MAX_VALUE_BYTES + " 字节），请只返回必要的摘要");
				return;
			}
			finish(true, serialized === undefined ? null : JSON.parse(serialized));
		}, function (err) {
			finish(false, undefined, "exception", describeError(err));
		});
	}
	parentPort.on("message", function (message) {
		if (!message || typeof message !== "object") return;
		if (message.t === "callResult") {
			var p = pending.get(message.id);
			if (!p) return;
			pending.delete(message.id);
			if (message.ok) p.resolve(message.value);
			else p.reject(toolCallError(message.tool, message.message));
		}
	});
	startRun(workerData);
})();`;

export async function runProgram(options: RunProgramOptions): Promise<PtcRunResult> {
	return new Promise<PtcRunResult>((resolve) => {
		const startedAt = Date.now();
		let settled = false;
		let pausedAt: number | null = null;
		let pausedMs = 0;
		let timer: NodeJS.Timeout | null = null;
		let worker: Worker;
		try {
			worker = new Worker(BOOTSTRAP, {
				eval: true,
				workerData: { code: options.code, toolNames: options.toolNames, cwd: options.cwd },
				resourceLimits: { maxOldGenerationSizeMb: options.maxOldGenerationMb },
				stdout: false,
				stderr: false,
			});
		} catch (err) {
			resolve({ ok: false, logs: [], failure: { kind: "worker-exit", message: describe(err) } });
			return;
		}

		const settle = (result: PtcRunResult): void => {
			if (settled) return;
			settled = true;
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
			options.signal?.removeEventListener("abort", onAbort);
			void worker.terminate().catch(() => {});
			log.info("program settled", { ok: result.ok, kind: result.failure?.kind, ms: Date.now() - startedAt });
			resolve(result);
		};

		const fail = (kind: PtcFailureKind, message: string): void => {
			settle({ ok: false, logs: [], failure: { kind, message } });
		};

		const arm = (): void => {
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
			if (pausedAt !== null || options.timeoutMs === null) return;
			const left = options.timeoutMs - (Date.now() - startedAt - pausedMs);
			if (left <= 0) {
				fail("timeout", `运行超过时间预算（${options.timeoutMs}ms）`);
				return;
			}
			timer = setTimeout(() => {
				fail("timeout", `运行超过时间预算（${options.timeoutMs}ms）`);
			}, left);
		};

		const control: PtcRunControl = {
			pauseClock() {
				if (options.timeoutMs === null || pausedAt !== null) return;
				pausedAt = Date.now();
				if (timer) {
					clearTimeout(timer);
					timer = null;
				}
			},
			resumeClock() {
				if (pausedAt === null) return;
				pausedMs += Date.now() - pausedAt;
				pausedAt = null;
				arm();
			},
		};

		const onAbort = (): void => fail("abort", "运行已取消");

		const handleCall = async (msg: Record<string, unknown>): Promise<void> => {
			const id = typeof msg.id === "number" ? msg.id : -1;
			const name = typeof msg.name === "string" ? msg.name : "";
			let ok = true;
			let value: unknown = null;
			let message = "";
			try {
				value = await options.dispatch(name, msg.args ?? null, control);
			} catch (err) {
				ok = false;
				message = describe(err);
			}
			if (settled) return;
			try {
				worker.postMessage({
					t: "callResult",
					id,
					ok,
					value: ok ? (value === undefined ? null : value) : undefined,
					message,
					tool: name,
				});
			} catch {}
		};

		const handleDone = (msg: Record<string, unknown>): void => {
			const logs = Array.isArray(msg.logs)
				? (msg.logs as unknown[]).filter((item): item is string => typeof item === "string")
				: [];
			const value = msg.value === undefined ? null : msg.value;
			const size = Buffer.byteLength(logs.join("\n")) + Buffer.byteLength(safeStringify(value));
			if (size > MAX_OUTPUT_BYTES) {
				settle({
					ok: false,
					logs,
					failure: { kind: "output-limit", message: `程序输出超过上限（${MAX_OUTPUT_BYTES} 字节）` },
				});
				return;
			}
			if (msg.ok === true) {
				settle({ ok: true, value, logs });
				return;
			}
			settle({
				ok: false,
				logs,
				failure: {
					kind: normalizeKind(msg.failureKind),
					message: typeof msg.message === "string" && msg.message.length > 0 ? msg.message : "程序执行失败",
				},
			});
		};

		worker.on("message", (message: unknown) => {
			if (!message || typeof message !== "object") return;
			const msg = message as Record<string, unknown>;
			if (msg.t === "call") void handleCall(msg);
			else if (msg.t === "done") handleDone(msg);
			else if (msg.t === "log") {
				const line = typeof msg.line === "string" ? msg.line : "";
				if (line) options.onLog?.(line);
			}
		});
		worker.on("error", (err) => fail("worker-exit", `程序执行线程异常：${describe(err)}`));
		worker.on("exit", (code) => {
			if (settled) return;
			fail("worker-exit", `程序执行线程意外退出（code=${code}，例如内存超限或调用了 process.exit）`);
		});

		if (options.signal) {
			if (options.signal.aborted) {
				fail("abort", "运行已取消");
				return;
			}
			options.signal.addEventListener("abort", onAbort, { once: true });
		}
		arm();
	});
}
