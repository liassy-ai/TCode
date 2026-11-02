import type { SessionModelUsage } from "@tcode/shared";
import { useCallback, useEffect, useState } from "react";
import { getPi } from "../api";

export function sessionCacheHitShare(usage: {
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	inputTokens?: number;
}): number | null {
	const read = usage.cacheReadTokens ?? 0;
	const write = usage.cacheWriteTokens ?? 0;
	const fresh = usage.inputTokens ?? 0;
	if (read + write <= 0 || read + fresh <= 0) return null;
	return (read / (read + fresh)) * 100;
}

const REFRESH_EVENTS = new Set([
	"message_end",
	"tool_execution_end",
	"turn_end",
	"agent_settled",
	"compaction_end",
	"session_info_changed",
	"thinking_level_changed",
	"model_select",
]);

export function useSessionModelStats(
	sessionId: string | null,
	model?: { id: string; label?: string } | null,
): { share: number | null; entry?: SessionModelUsage } {
	const [state, setState] = useState<{ share: number | null; entry?: SessionModelUsage }>({ share: null });
	const modelKey = model ? `${model.id}\u0000${model.label ?? ""}` : "";
	const refresh = useCallback(() => {
		if (!sessionId) return;
		void getPi()
			.getStats({ sessionId })
			.then((stats) => {
				const entry = model
					? stats.byModel.find((m) => m.model === model.id || (model.label ? m.model === model.label : false))
					: undefined;
				setState({ share: sessionCacheHitShare(entry ?? stats), entry });
			})
			.catch(() => {});
	}, [sessionId, modelKey]);
	useEffect(() => {
		void refresh();
	}, [refresh]);
	useEffect(() => {
		if (!sessionId) return;
		const off = getPi().onEvent(({ sessionId: sid, event }) => {
			if (sid !== sessionId || !REFRESH_EVENTS.has(event.type)) return;
			void refresh();
		});
		return off;
	}, [sessionId, refresh]);
	return state;
}
