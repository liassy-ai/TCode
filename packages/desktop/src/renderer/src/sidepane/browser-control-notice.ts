import { create } from "zustand";

export interface BrowserControlNotice {
	tabId: string;
	status: "active" | "done";

	mode: "view" | "act";

	op?: string;
}

interface BrowserControlNoticeState {
	notice: BrowserControlNotice | null;

	show: (tabId: string, mode?: "view" | "act", op?: string) => void;

	markDone: (tabId: string) => void;
	clear: () => void;
}

const ACTIVE_FAILSAFE_MS = 30_000;

const DONE_LINGER_MS = 4_000;

let expireTimer: number | null = null;

function armExpire(ms: number, clear: () => void): void {
	if (expireTimer !== null) window.clearTimeout(expireTimer);
	expireTimer = window.setTimeout(() => {
		expireTimer = null;
		clear();
	}, ms);
}

export const useBrowserControlNoticeStore = create<BrowserControlNoticeState>((set, get) => ({
	notice: null,
	show: (tabId, mode = "view", op) => {
		set({ notice: { tabId, status: "active", mode, ...(op ? { op } : {}) } });
		armExpire(ACTIVE_FAILSAFE_MS, () => get().clear());
	},
	markDone: (tabId) => {
		if (get().notice?.tabId !== tabId) return;
		const prev = get().notice;
		set({
			notice: {
				tabId,
				status: "done",
				mode: prev?.mode ?? "view",

				...(prev?.op ? { op: prev.op } : {}),
			},
		});
		armExpire(DONE_LINGER_MS, () => get().clear());
	},
	clear: () => {
		if (expireTimer !== null) {
			window.clearTimeout(expireTimer);
			expireTimer = null;
		}
		set({ notice: null });
	},
}));
