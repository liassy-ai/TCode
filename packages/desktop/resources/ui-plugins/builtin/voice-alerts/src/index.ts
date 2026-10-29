import { stores } from "@tcode/plugin-api";
import approvalUrl from "./assets/approval.mp3";
import doneUrl from "./assets/done.mp3";


interface StoreApi<T> {
	getState: () => T;
	subscribe: (listener: () => void) => () => void;
}

interface SessionEntryLike {
	agentActive?: boolean;
	compacting?: boolean;
	pendingPermissions?: unknown[];
}

const { useTranscriptStore, useSessionsStore } = stores as {
	useTranscriptStore: StoreApi<{ bySession: Record<string, SessionEntryLike> }>;
	useSessionsStore: StoreApi<{ sessions: { sessionId: string }[] }>;
};

const QUIET_MS = 5000;
const VOLUME = 0.9;

export function activate(): () => void {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let completionArmed = false;
	let notifiedPending = 0;
	let prevWorking = false;
	let prevPending = 0;

	const clearTimer = () => {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	};

	const play = (url: string) => {
		const audio = new Audio(url);
		audio.volume = VOLUME;
		audio.play().catch((err) => console.error("[voice-alerts] 播放失败", err));
	};

	const derive = (): { working: boolean; pending: number } => {
		const open = new Set(useSessionsStore.getState().sessions.map((s) => s.sessionId));
		let working = false;
		let pending = 0;
		for (const [id, entry] of Object.entries(useTranscriptStore.getState().bySession)) {
			if (!open.has(id)) continue;
			const p = entry.pendingPermissions?.length ?? 0;
			if (p > 0) pending += p;
			else if (entry.agentActive || entry.compacting) working = true;
		}
		return { working, pending };
	};

	const settle = () => {
		timer = null;
		const { working, pending } = derive();
		if (working) return;
		if (pending > 0) {
			if (pending > notifiedPending) {
				play(approvalUrl);
				notifiedPending = pending;
				completionArmed = false;
			}
			return;
		}
		if (completionArmed) {
			play(doneUrl);
			completionArmed = false;
		}
	};

	const onStoreChange = () => {
		const { working, pending } = derive();
		if (prevWorking && !working) completionArmed = true;
		if (pending < prevPending) notifiedPending = Math.min(notifiedPending, pending);
		prevWorking = working;
		prevPending = pending;
		if (working) {
			clearTimer();
			return;
		}
		clearTimer();
		timer = setTimeout(settle, QUIET_MS);
	};

	const base = derive();
	prevWorking = base.working;
	prevPending = base.pending;
	notifiedPending = base.pending;

	const unsubs = [useTranscriptStore.subscribe(onStoreChange), useSessionsStore.subscribe(onStoreChange)];

	return () => {
		clearTimer();
		for (const unsub of unsubs) unsub();
	};
}
