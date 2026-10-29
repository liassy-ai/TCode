import { messagesToUIMessages } from "@tcode/shared";
import { getPi } from "../api";
import { useTranscriptStore } from "./transcript";

const ready = new Set<string>();
const pending = new Map<string, { generation: number; isOpen: () => boolean }>();
const inFlight = new Map<string, number>();
let generation = 0;
const openEpoch = new Map<string, number>();

export function historyOpenEpoch(sessionId: string): number {
	return openEpoch.get(sessionId) ?? 0;
}

export function isHistoryReady(sessionId: string): boolean {
	return ready.has(sessionId);
}

export function hasPendingSessionHistory(sessionId: string): boolean {
	return pending.has(sessionId);
}

export function clearSessionHistory(sessionId: string): void {
	openEpoch.set(sessionId, historyOpenEpoch(sessionId) + 1);
	ready.delete(sessionId);
	pending.delete(sessionId);
}

export function finishSessionHistory(sessionId: string): void {
	pending.delete(sessionId);
	ready.add(sessionId);
	void getPi()
		.markSessionHistoryReady({ sessionId })
		.catch((error: unknown) => {
			console.warn("会话历史就绪回执失败", error);
		});
}

export function deferSessionHistory(sessionId: string, isOpen: () => boolean): void {
	if (ready.has(sessionId)) return;
	pending.set(sessionId, { generation: ++generation, isOpen });
	void retrySessionHistory(sessionId);
}

export async function retrySessionHistory(sessionId: string): Promise<void> {
	const work = pending.get(sessionId);
	if (!work || inFlight.get(sessionId) === work.generation || !work.isOpen()) return;
	if (useTranscriptStore.getState().bySession[sessionId]?.agentActive) return;
	inFlight.set(sessionId, work.generation);
	let stale = false;
	try {
		const before = useTranscriptStore.getState().bySession[sessionId];
		const history = await getPi().getSessionMessages({ sessionId });
		const after = useTranscriptStore.getState().bySession[sessionId];
		if (pending.get(sessionId)?.generation !== work.generation || !work.isOpen()) {
			stale = true;
			return;
		}
		if (after?.agentActive || before !== after) {
			stale = !after?.agentActive;
			return;
		}
		useTranscriptStore.getState().loadHistory(sessionId, messagesToUIMessages(history));
		finishSessionHistory(sessionId);
	} catch (error) {
		console.warn("会话历史补拉失败，等待下次重试", error);
	} finally {
		if (inFlight.get(sessionId) === work.generation) inFlight.delete(sessionId);
		if (stale && pending.has(sessionId)) void retrySessionHistory(sessionId);
	}
}
