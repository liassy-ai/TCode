import type { AgentToolResult, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { PtcSubCallEvent } from "@tcode/shared";
import { Type } from "typebox";
import type { PermissionEvaluator } from "../../permissions/evaluator";
import { PtcBridge, type PtcDispatchInfo } from "./bridge";
import { runProgram } from "./runner";

export const RUN_CODE_TOOL_NAME = "run_code";

const DEFAULT_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_CODE_CHARS = 200_000;
const MAX_RESULT_CHARS = 50_000;
const MAX_ERROR_LOGS_CHARS = 8_000;
const MAX_OLD_GENERATION_MB = 256;

const runCodeParams = Type.Object({
	description: Type.String({
		minLength: 1,
		description:
			"Clear, concise description of what this program does in active voice, 5-10 words (shown in the UI). Provide `description` before `code`.",
	}),
	code: Type.String({
		minLength: 1,
		description:
			"The program: the body of an async function (top-level `await` and `return` are supported); call tools via `await tools.name(args)`.",
	}),
	timeoutMs: Type.Optional(
		Type.Number({
			description:
				"Elapsed-time budget in milliseconds (default 120000, max 600000); time waiting for user approval does not count.",
		}),
	),
});

export interface RunCodeDetails {
	description: string;
	logs: string[];
	value: unknown;
	subCalls: PtcDispatchInfo[];
}

export interface RunCodeToolDeps {
	getActiveTools: () => string[];

	resolveTool: (sessionId: string | undefined, name: string) => ToolDefinition | undefined;

	evaluator?: PermissionEvaluator;

	onDispatch?: (sessionId: string | undefined, info: PtcDispatchInfo) => void;

	onSubCall?: (sessionId: string | undefined, event: PtcSubCallEvent) => void;

	onProgramFailure?: (toolCallId: string, details: RunCodeDetails) => void;
}

function clampTimeout(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
	return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(value)));
}

function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		return String(value);
	}
}

function formatSubCallLine(event: PtcSubCallEvent): string {
	if (event.phase === "start") {
		const args = (event.args ?? "").replace(/\s+/g, " ").trim();
		if (!args) return `-> ${event.tool}`;
		return `-> ${event.tool} ${args.length > 120 ? `${args.slice(0, 120)}…` : args}`;
	}
	if (event.ok === false) return `<- ${event.tool} fail: ${(event.error ?? "未知错误").slice(0, 160)}`;
	return `<- ${event.tool} ok${event.durationMs == null ? "" : ` ${event.durationMs}ms`}`;
}
function renderSuccess(description: string, logs: string[], value: unknown): string {
	const body: string[] = [];
	const logText = logs.join("\n").trim();
	if (logText.length > 0) body.push(logText);
	if (value !== null && value !== undefined) body.push(`Return value:\n${safeJson(value)}`);
	if (body.length === 0) body.push("(程序未输出任何内容——需要保留的信息请 return 或 console.log)");

	const text = `${description ? `${description}\n\n` : ""}${body.join("\n\n")}`;
	return text.length <= MAX_RESULT_CHARS ? text : `${text.slice(0, MAX_RESULT_CHARS)}\n[... 输出截断]`;
}

function sessionIdOf(ctx: ExtensionContext): string | undefined {
	try {
		return ctx.sessionManager?.getSessionId();
	} catch {
		return undefined;
	}
}

export function makeRunCodeTool(deps: RunCodeToolDeps): ToolDefinition<typeof runCodeParams, RunCodeDetails> {
	return {
		name: RUN_CODE_TOOL_NAME,
		label: "Run Code",
		description:
			"Strongly preferred path for multi-step work - treat it as your default: anything needing more than one tool call belongs in one program here, not in a chain of direct read/grep/edit/bash calls. If you are about to make a second direct tool call, stop and write the program instead.\n\nThe program: the body of an async function (TypeScript - annotations are stripped; top-level `await` and `return` are supported), executed in a fresh child process with the project as working directory. `tools` exposes EVERY tool of your own tool list as `await tools.<name>(args)`, with exactly the parameters of its normal schema - e.g. `await tools.edit({ path, edits: [{ oldText, newText }] })`; the default set is read/write/edit/bash/powershell/grep/find/glob/ls/webfetch/todo/subagent/ask_user/show_image/browser. Each sub-call follows the normal permission rules and resolves to that tool's text output (a string, not a `{content}` object); an unknown name, a failed or a denied sub-call throws a catchable ToolCallError. run_code cannot be nested. Images are not returned through the sub-call value - they are attached to run_code's outer result. A program may make at most 10 sub-calls - the 11th throws a catchable ToolCallError, so size fan-out loops to 10 or fewer and put the remaining work in the next program. Within that budget, loop, branch or run sub-calls in parallel inside the one program.\n\nNot available: the environment is otherwise empty - no `import`/`require`, `fetch`, `process`, `Buffer`, `fs` or env vars; every file, command, network or model-side action must go through `tools.*`. Only what the program returns or console.logs re-enters the conversation: return the data worth keeping (JSON-serializable, 512KB cap) and console.log the progress lines you want to see (256KB total output cap - a larger result fails the run). Required parameters: `description` (concise 5-10 word UI label, before `code`) and `code` (the program body).",
		promptSnippet:
			"run_code({description, code}) - write ONE TypeScript program that calls this session's tools (read/edit/write/bash/grep/todo/subagent/...) in a single pass; only what it returns or console.logs re-enters the context",
		promptGuidelines: [
			"Prefer run_code for multi-step or multi-file work (batch edits, loops over grep/find results, fan-out reads): one call replaces many sequential tool calls and keeps intermediate results out of context. A second direct tool call in a row is the signal to write a program",
			"In run_code programs, call tools as `await tools.name(args)` with the same arguments as the normal schema; independent read-only calls may run under Promise.all, while writes should be awaited individually so a failure points at one tool",
			"`await tools.x(...)` resolves to that tool's text output (a string), NOT a `{content}` object - use the returned value directly as the tool's text; an unknown name, a failed or a denied sub-call throws a catchable ToolCallError",
			"run_code programs may return any JSON value; only the returned value and console.log output re-enter the conversation",
			"A single program may make at most 10 sub-calls (the 11th throws a catchable ToolCallError): spend them on the calls that matter and chain a second program when the work needs more — size fan-out loops to the budget instead of writing a loop that dies halfway",
			"One task, one program, one pass: fuse recon, the operations and the self-verification into the single program you write (read state → decide → write → re-read to confirm) instead of splitting them across extra calls; open another round only when a step genuinely needs user input or a failure must be inspected before continuing",
		],
		parameters: runCodeParams,
		execute: async (toolCallId, params, signal, onUpdate, ctx): Promise<AgentToolResult<RunCodeDetails>> => {
			const code = typeof params.code === "string" ? params.code : "";
			if (code.trim().length === 0) throw new Error("run_code: `code` 不能为空");
			if (code.length > MAX_CODE_CHARS) {
				throw new Error(`run_code: 程序过长（${code.length} > ${MAX_CODE_CHARS} 字符）`);
			}
			const description = typeof params.description === "string" ? params.description.trim() : "";
			const timeoutMs = clampTimeout(params.timeoutMs);
			const sessionId = sessionIdOf(ctx);
			const toolNames = deps.getActiveTools().filter((name) => name !== RUN_CODE_TOOL_NAME);

			const progressLines: string[] = [];
			let flushTimer: NodeJS.Timeout | null = null;
			const flushProgress = () => {
				if (flushTimer) {
					clearTimeout(flushTimer);
					flushTimer = null;
				}
				if (progressLines.length === 0) return;
				const chunk = `${progressLines.join("\n")}\n`;
				progressLines.length = 0;
				try {
					onUpdate?.({
						content: [{ type: "text", text: chunk }],
						details: { description, logs: [chunk], value: undefined, subCalls: [] },
					});
				} catch {}
			};
			const pushProgress = (line: string) => {
				if (!line) return;
				progressLines.push(line);
				if (progressLines.length >= 8) flushProgress();
				else if (!flushTimer) flushTimer = setTimeout(flushProgress, 150);
			};
			const bridge = new PtcBridge({
				evaluator: deps.evaluator,
				resolveTool: deps.resolveTool,
				sessionId,
				cwd: ctx.cwd,
				parentToolCallId: toolCallId,
				ctx,
				onDispatch: (info) => deps.onDispatch?.(sessionId, info),
				onSubCall: (event) => {
					deps.onSubCall?.(sessionId, event);
					pushProgress(formatSubCallLine(event));
				},
			});
			try {
				const result = await runProgram({
					code,
					toolNames,
					cwd: ctx.cwd,
					timeoutMs,
					signal,
					dispatch: bridge.dispatch,
					maxOldGenerationMb: MAX_OLD_GENERATION_MB,
					onLog: pushProgress,
				});
				if (!result.ok) {
					const failure = result.failure ?? { kind: "exception", message: "程序执行失败" };
					const logsTail = result.logs.join("\n").slice(-MAX_ERROR_LOGS_CHARS);

					deps.onProgramFailure?.(toolCallId, {
						description,
						logs: result.logs,
						value: undefined,
						subCalls: bridge.summaries,
					});
					throw new Error(
						`run_code 执行失败（${failure.kind}）：${failure.message}${
							logsTail ? `\n\n程序输出（尾部）：\n${logsTail}` : ""
						}`,
					);
				}
				return {
					content: [
						{ type: "text" as const, text: renderSuccess(description, result.logs, result.value) },
						...bridge.images,
					],
					details: {
						description,
						logs: result.logs,
						value: result.value,
						subCalls: bridge.summaries,
					},
				};
			} finally {
				flushProgress();
				bridge.dispose();
			}
		},
	};
}
