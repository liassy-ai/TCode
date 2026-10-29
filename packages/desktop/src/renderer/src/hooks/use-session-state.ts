import type { AvailableModel } from "@tcode/shared";
import { useSessionsStore } from "../stores/sessions";
import { useTranscriptStore } from "../stores/transcript";

export function useActiveModelInfo(): AvailableModel | undefined {
	return useSessionsStore((s) => {
		const sessionModel = s.sessions.find((x) => x.sessionId === s.activeSessionId)?.model;
		const effective =
			s.activeSessionId === null ? s.newSessionDraft?.model : (sessionModel ?? s.lastUsedModel);
		if (!effective) return undefined;
		return s.models.find((m) => m.provider === effective.provider && m.id === effective.modelId);
	});
}

export function useSessionReadOnly(sessionId?: string | null): boolean {
	return useSessionsStore((s) => {
		const id = sessionId ?? s.activeSessionId;
		return s.sessions.find((x) => x.sessionId === id)?.readOnly === true;
	});
}

export function useSessionBusy(sessionId: string | null): boolean {
	return useTranscriptStore((s) => {
		if (!sessionId) return false;
		const entry = s.bySession[sessionId];
		return entry?.agentActive === true || entry?.compacting === true;
	});
}

export function useThinkingLevelState(): {
	effective: string;
	display: string;
} {
	const effective = useSessionsStore((s) => {
		const draft = s.activeSessionId === null ? s.newSessionDraft?.thinkingLevel : undefined;
		const session = s.sessions.find((x) => x.sessionId === s.activeSessionId);
		return draft ?? session?.thinkingLevel ?? s.lastUsedThinkingLevel;
	});
	return { effective, display: effective };
}
