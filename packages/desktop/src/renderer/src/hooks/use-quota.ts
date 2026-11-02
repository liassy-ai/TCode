import type { QuotaInfo } from "@tcode/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { getPi } from "../api";

const POLL_MS = 60_000;

const REFRESH_EVENTS = new Set(["turn_end", "agent_settled"]);

function isRefreshEvent(type: string): boolean {
	return REFRESH_EVENTS.has(type);
}

export function useQuota(): QuotaInfo | null {
	const [quota, setQuota] = useState<QuotaInfo | null>(null);
	const cancelledRef = useRef(false);

	const refresh = useCallback(async () => {
		try {
			const next = await getPi().getQuota();
			if (!cancelledRef.current) setQuota(next);
		} catch {
			if (!cancelledRef.current) setQuota(null);
		}
	}, []);

	useEffect(() => {
		cancelledRef.current = false;
		void refresh();
		const timer = setInterval(() => {
			void refresh();
		}, POLL_MS);
		return () => {
			cancelledRef.current = true;
			clearInterval(timer);
		};
	}, [refresh]);

	useEffect(() => {
		const off = getPi().onEvent(({ event }) => {
			if (!isRefreshEvent(event.type)) return;
			void refresh();
		});
		return off;
	}, [refresh]);

	return quota;
}
