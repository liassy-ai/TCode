import type { InlineExtension, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { PtcSubCallEvent } from "@tcode/shared";
import { createLogger } from "../../log";
import type { PermissionEvaluator } from "../../permissions/evaluator";
import type { PtcDispatchInfo } from "./bridge";
import { makeRunCodeTool, RUN_CODE_TOOL_NAME, type RunCodeDetails } from "./tool";

const log = createLogger("ptc");

export interface PtcExtensionOptions {
	evaluator?: PermissionEvaluator;

	resolveTool: (sessionId: string | undefined, name: string) => ToolDefinition | undefined;

	onDispatch?: (sessionId: string | undefined, info: PtcDispatchInfo) => void;

	onSubCall?: (sessionId: string | undefined, event: PtcSubCallEvent) => void;
}

export function makePtcExtension(options: PtcExtensionOptions): InlineExtension {
	return {
		name: "ptc",
		factory: (pi) => {
			const failedRuns = new Map<string, RunCodeDetails>();
			pi.registerTool(
				makeRunCodeTool({
					getActiveTools: () => pi.getActiveTools(),
					resolveTool: options.resolveTool,
					evaluator: options.evaluator,
					onDispatch: options.onDispatch,
					onSubCall: options.onSubCall,
					onProgramFailure: (toolCallId, details) => {
						if (failedRuns.size >= 64) failedRuns.clear();
						failedRuns.set(toolCallId, details);
					},
				}),
			);

			pi.on("tool_result", (event) => {
				if (event.toolName !== RUN_CODE_TOOL_NAME || !event.isError) return;
				const stash = failedRuns.get(event.toolCallId);
				if (!stash) return;
				failedRuns.delete(event.toolCallId);
				return { details: stash, isError: true };
			});

			const activate = (): void => {
				try {
					const active = pi.getActiveTools();
					if (!active.includes(RUN_CODE_TOOL_NAME)) {
						pi.setActiveTools([...active, RUN_CODE_TOOL_NAME]);
						log.info("run_code activated");
					}
				} catch (err) {
					log.warn("run_code 激活面同步失败", {
						error: err instanceof Error ? err.message : String(err),
					});
				}
			};
			pi.on("session_start", () => {
				activate();
			});
			pi.on("before_agent_start", () => {
				activate();
			});
		},
	};
}
