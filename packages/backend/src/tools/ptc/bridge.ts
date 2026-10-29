import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { PtcSubCallEvent } from "@tcode/shared";
import { createLogger } from "../../log";
import type { PermissionEvaluator } from "../../permissions/evaluator";
import type { PtcRunControl } from "./runner";

const log = createLogger("ptc");

const MAX_PARALLEL_SUB_CALLS = 10;

const MAX_SUB_CALLS_PER_RUN = 10;

const MAX_SUB_CALL_ARGS_CHARS = 300;

const STRUCTURED_ARGS_TOOLS = new Set(["ask_user", "questionnaire"]);

const MAX_SUB_CALL_RESULT_CHARS = 100_000;

const MAX_IMAGES = 8;

export interface PtcDispatchInfo {
	id: string;
	tool: string;
	ok: boolean;
	durationMs: number;

	args?: string;
	error?: string;
}

export interface PtcBridgeOptions {
	evaluator?: PermissionEvaluator;

	resolveTool: (sessionId: string | undefined, name: string) => ToolDefinition | undefined;
	sessionId?: string;
	cwd: string;

	parentToolCallId: string;

	ctx: ExtensionContext;
	onDispatch?: (info: PtcDispatchInfo) => void;

	onSubCall?: (event: PtcSubCallEvent) => void;
}

interface QueuedCall {
	barrier: boolean;
	start: () => void;
	fail: (err: Error) => void;
}

function textOfContent(content: Array<{ type: string; text?: string }>): string {
	const parts: string[] = [];
	for (const block of content) {
		if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
	}
	return parts.join("\n");
}

function truncate(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max)}\n[... 输出被 run_code 截断]`;
}

export class PtcBridge {
	readonly summaries: PtcDispatchInfo[] = [];
	readonly images: Array<{ type: "image"; data: string; mimeType: string }> = [];
	private seq = 0;
	private disposed = false;
	private readonly queue: QueuedCall[] = [];
	private running = 0;
	private barrierRunning = false;
	private readonly inFlight = new AbortController();

	constructor(private readonly options: PtcBridgeOptions) {}

	readonly dispatch = async (name: string, args: unknown, control: PtcRunControl): Promise<unknown> => {
		if (this.disposed) throw new Error("run_code 已结束");

		if (this.seq >= MAX_SUB_CALLS_PER_RUN) {
			throw new Error(
				`run_code 单次程序最多调用 ${MAX_SUB_CALLS_PER_RUN} 次工具（第 ${this.seq + 1} 次「${name}」被拒）：把剩余工作放进下一个程序`,
			);
		}
		const tool = this.options.resolveTool(this.options.sessionId, name);
		if (!tool) throw new Error(`工具 "${name}" 在本会话不可用`);
		const id = `${this.options.parentToolCallId}:ptc:${++this.seq}`;
		const barrier = tool.executionMode === "sequential";
		return new Promise<unknown>((resolve, reject) => {
			const item: QueuedCall = {
				barrier,
				start: () => {
					this.running += 1;
					if (barrier) this.barrierRunning = true;
					void this.executeOne(id, name, tool, args, control)
						.then(resolve, reject)
						.finally(() => {
							this.running -= 1;
							if (this.running === 0) this.barrierRunning = false;
							this.pump();
						});
				},
				fail: (err) => reject(err),
			};
			this.queue.push(item);
			this.pump();
		});
	};

	private pump(): void {
		while (this.queue.length > 0) {
			const next = this.queue[0];
			if (!next) return;
			if (next.barrier) {
				if (this.running === 0) {
					this.queue.shift();
					next.start();
				}
				return;
			}
			if (this.barrierRunning || this.running >= MAX_PARALLEL_SUB_CALLS) return;
			this.queue.shift();
			next.start();
		}
	}

	private async executeOne(
		id: string,
		name: string,
		tool: ToolDefinition,
		rawArgs: unknown,
		control: PtcRunControl,
	): Promise<unknown> {
		const startAt = Date.now();
		let ok = false;
		let error: string | undefined;
		let argsPreview: string | undefined;
		try {
			if (this.disposed) throw new Error("run_code 已结束");
			const raw =
				rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
					? (rawArgs as Record<string, unknown>)
					: {};
			const prepared = (tool.prepareArguments ? tool.prepareArguments(raw) : raw) as Record<string, unknown>;
			const argsJson = JSON.stringify(prepared ?? {});

			argsPreview = STRUCTURED_ARGS_TOOLS.has(name) ? argsJson : truncate(argsJson, MAX_SUB_CALL_ARGS_CHARS);

			this.emitSubCall({
				type: "ptc_subcall",
				phase: "start",
				id,
				parentToolCallId: this.options.parentToolCallId,
				tool: name,
				args: argsPreview,
			});

			if (this.options.evaluator) {
				control.pauseClock();
				let blockReason: string | null = null;
				try {
					const verdict = await this.options.evaluator.evaluate({
						toolName: name,
						input: prepared,
						sessionId: this.options.sessionId,
						cwd: this.options.cwd,
					});
					if (verdict.verdict === "block") blockReason = verdict.reason;
				} finally {
					control.resumeClock();
				}
				if (blockReason !== null) throw new Error(blockReason);
			}
			const result = await tool.execute(id, prepared, this.inFlight.signal, undefined, this.options.ctx);
			const text = textOfContent(result.content);
			for (const block of result.content) {
				if (block.type === "image" && this.images.length < MAX_IMAGES) {
					this.images.push({ type: "image", data: block.data, mimeType: block.mimeType });
				}
			}
			if ((result as { isError?: boolean }).isError) {
				throw new Error(text.length > 0 ? text : `工具 ${name} 返回错误`);
			}
			ok = true;
			return truncate(text, MAX_SUB_CALL_RESULT_CHARS);
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
			throw new Error(`[${name}] ${error}`);
		} finally {
			const info: PtcDispatchInfo = {
				id,
				tool: name,
				ok,
				durationMs: Date.now() - startAt,
				...(argsPreview !== undefined ? { args: argsPreview } : {}),
				...(error ? { error } : {}),
			};
			this.summaries.push(info);
			log.info("dispatch", id, {
				tool: info.tool,
				ok: info.ok,
				durationMs: info.durationMs,
				error: info.error,
			});
			try {
				this.options.onDispatch?.(info);
			} catch {}
			this.emitSubCall({
				type: "ptc_subcall",
				phase: "end",
				id,
				parentToolCallId: this.options.parentToolCallId,
				tool: name,
				ok,
				durationMs: info.durationMs,
				...(error ? { error } : {}),
			});
		}
	}

	private emitSubCall(event: PtcSubCallEvent): void {
		try {
			this.options.onSubCall?.(event);
		} catch {}
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.inFlight.abort();
		for (const item of this.queue.splice(0)) {
			item.fail(new Error("run_code 已结算，排队中的子调用被放弃"));
		}
	}
}
