import type { ExtensionContext, InlineExtension } from "@earendil-works/pi-coding-agent";
import { createLogger } from "../../log";
import { readContextManagerMode, readEvapConfig } from "./config";
import { evaporateWire } from "./evaporate";
import type { EvapWireMessage } from "./types";
import { createEvapState, type EvapBatchInfo, type EvapConfig, type EvapState } from "./types";

const log = createLogger("context-evaporation");

export interface EvapExtensionOptions {
	agentDir: string;

	isEnabled?: () => boolean;

	getConfig?: () => EvapConfig;

	reporter?: (sessionId: string, batch: EvapBatchInfo) => void;
}

export function makeEvapExtension(options: EvapExtensionOptions): InlineExtension {
	return {
		name: "context-evaporation",
		factory: (pi) => {
			const enabled = options.isEnabled ?? (() => readContextManagerMode(options.agentDir) === "evaporation");
			const getConfig = options.getConfig ?? (() => readEvapConfig(options.agentDir));
			const report =
				options.reporter ?? ((sessionId: string, batch: EvapBatchInfo) => reportBatch(sessionId, batch));
			let currentSessionId = "";

			let active = false;
			let state: EvapState = createEvapState();

			const liveEnabled = (): boolean => active && enabled();

			let lockTail: Promise<unknown> = Promise.resolve();
			function withLock<T>(fn: () => Promise<T>): Promise<T> {
				const run = lockTail.then(fn, fn);
				lockTail = run.then(
					() => {},
					() => {},
				);
				return run;
			}

			function windowTokensFor(ctx: ExtensionContext | undefined, config: EvapConfig): number {
				const modelWindow = ctx?.model?.contextWindow ?? 0;
				return Math.min(modelWindow, config.budgetTokens) || config.budgetTokens;
			}

			pi.on("session_start", async (_event, ctx) => {
				try {
					if (!enabled()) {
						active = false;
						return;
					}
					active = true;
					state = createEvapState();
					currentSessionId = ctx.sessionManager.getSessionId();
					log.info("evaporation enabled", { sessionId: currentSessionId });
				} catch (err) {
					active = false;
					log.error("evaporation session_start 失败，降级关闭", {
						error: err instanceof Error ? err.message : String(err),
					});
				}
			});

			pi.on("session_compact", async (_event) => {
				try {
					if (!active) return;

					state = createEvapState();
					log.info("evaporation 决策已重置（SDK compaction 后）");
				} catch (err) {
					log.warn("evaporation 决策重置失败", {
						error: err instanceof Error ? err.message : String(err),
					});
				}
			});

			pi.on("context", async (event, ctx) => {
				if (!liveEnabled()) return undefined;

				let config: EvapConfig;
				let windowTokens: number;
				try {
					config = getConfig();
					windowTokens = windowTokensFor(ctx, config);
				} catch (err) {
					log.error("evaporation 配置读取失败，原样放行", {
						error: err instanceof Error ? err.message : String(err),
					});
					return undefined;
				}

				let usageTokens: number | null = null;
				try {
					usageTokens = ctx.getContextUsage()?.tokens ?? null;
				} catch {
					usageTokens = null;
				}

				return withLock(async () => {
					const wire = event.messages as unknown as EvapWireMessage[];
					const result = evaporateWire(wire, state, config, {
						windowTokens,
						usageTokens,
					});
					if (result.batch.snipped + result.batch.pruned > 0) {
						report(currentSessionId, result.batch);
					}

					if (result.messages === wire) return undefined;
					return { messages: result.messages as unknown as typeof event.messages };
				}).catch((err: unknown) => {
					log.error("evaporation context 变换失败，原样放行", {
						error: err instanceof Error ? err.message : String(err),
					});
					return undefined;
				});
			});
		},
	};
}

export function reportEvapBatch(sessionId: string, batch: EvapBatchInfo): void {
	reportBatch(sessionId, batch);
}

function reportBatch(sessionId: string, batch: EvapBatchInfo): void {
	log.info("evap batch", {
		sessionId: sessionId.slice(0, 8),
		tier: batch.tier,
		usagePct: Math.round(batch.usagePct * 10) / 10,
		snipped: batch.snipped,
		pruned: batch.pruned,
		savedEstTokens: Math.round(batch.savedEstTokens),
		wireEstTokens: Math.round(batch.wireEstTokens),
		cacheHits: batch.cacheHits,
		mapSize: batch.mapSize,
	});
}
