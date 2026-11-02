import type { ContextUsageInfo } from "@tcode/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { getPi } from "../api";

const REFRESH_EVENTS = new Set([
	"message_end",
	"tool_execution_end",
	"turn_end",
	"agent_settled",
	"compaction_end",
	"session_info_changed",
]);

function isRefreshEvent(type: string): boolean {
	return REFRESH_EVENTS.has(type);
}

export function useContextUsage(sessionId: string | null, refreshKey?: string): ContextUsageInfo | null {
	const [usage, setUsage] = useState<ContextUsageInfo | null>(null);

	const cancelledRef = useRef(false);

	const refresh = useCallback(async () => {
		if (!sessionId) {
			setUsage(null);
			return;
		}
		try {
			const next = await getPi().getContextUsage({ sessionId });
			if (!cancelledRef.current) setUsage(next);
		} catch {
			if (!cancelledRef.current) setUsage(null);
		}
	}, [sessionId]);

	useEffect(() => {
		cancelledRef.current = false;
		void refresh();
		return () => {
			cancelledRef.current = true;
		};
	}, [refresh, refreshKey]);

	useEffect(() => {
		const off = getPi().onEvent(({ sessionId: sid, event }) => {
			if (sid !== sessionId || !isRefreshEvent(event.type)) return;
			void refresh();
		});
		return off;
	}, [sessionId, refresh]);

	return usage;
}
