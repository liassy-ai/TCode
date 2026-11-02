import type { BashOperations, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { killShellCall, runComponentShell } from "./component-bridge";

const operations: BashOperations = {
	async exec(command, runCwd, options) {
		const env = options.env ?? process.env;
		const onData = options.onData;
		const signal = options.signal;

		if (signal?.aborted) {
			throw new Error("aborted");
		}

		let callId: number | undefined;
		const onAbort = () => {
			if (callId != null) killShellCall(callId);
		};
		if (signal) signal.addEventListener("abort", onAbort, { once: true });

		try {
			const result = await runComponentShell({
				cwd: runCwd,
				script: command,
				timeoutMs: options.timeout ? options.timeout * 1000 : 0,
				env: env as Record<string, string>,
				onStart: (id) => {
					callId = id;
					if (signal?.aborted) killShellCall(id);
				},
				onChunk: onData
					? (data) => {
							onData(Buffer.from(data, "utf8"));
						}
					: undefined,
			});

			if (result.timedOut) {
				throw new Error(`timeout:${options.timeout}`);
			}
			if (signal?.aborted) {
				throw new Error("aborted");
			}

			return { exitCode: result.canceled ? null : result.exitCode };
		} finally {
			if (signal) signal.removeEventListener("abort", onAbort);
		}
	},
};

export function makeComponentBashTool(fallbackCwd: string): ToolDefinition {
	const base = createBashToolDefinition(fallbackCwd, { operations });
	return {
		...base,
		execute: (
			toolCallId: string,
			params: { command: string; timeout?: number },
			signal: AbortSignal | undefined,
			onUpdate: Parameters<typeof base.execute>[3],
			ctx: Parameters<typeof base.execute>[4],
		) => {
			const definition = createBashToolDefinition(ctx?.cwd ?? fallbackCwd, { operations });
			return definition.execute(toolCallId, params, signal, onUpdate, ctx);
		},
	} as unknown as ToolDefinition;
}
