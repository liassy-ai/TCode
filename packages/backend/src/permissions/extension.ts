import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { createPermissionEvaluator, type PermissionGateOptions } from "./evaluator";

export type { PermissionConfirm, PermissionGateOptions, PermissionModeRef } from "./evaluator";

export function makePermissionGateExtension(
	agentDir: string,
	options?: PermissionGateOptions,
): InlineExtension {
	return {
		name: "permission-gate",
		factory: (pi) => {
			const evaluator = options?.evaluator ?? createPermissionEvaluator(agentDir, options);
			pi.on("tool_call", async (event, ctx) => {
				const result = await evaluator.evaluate({
					toolName: event.toolName,
					input: (event.input ?? {}) as Record<string, unknown>,
					sessionId: ctx.sessionManager?.getSessionId(),
					cwd: ctx.cwd,
					uiConfirm: (title, message) => ctx.ui.confirm(title, message),
				});
				if (result.verdict === "block") {
					return { block: true, reason: result.reason };
				}
			});
		},
	};
}
