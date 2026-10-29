import type { SessionEvent, TrustRequest } from "@tcode/shared";
import { useEffect } from "react";
import { getPi } from "../api";
import { useDraftStore } from "../stores/drafts";
import { EventConflator } from "../stores/event-conflator";
import { useProjectsStore } from "../stores/projects";
import { retrySessionHistory } from "../stores/session-history";
import { useSessionsStore } from "../stores/sessions";
import { pushExtensionToast } from "../stores/toasts";
import { useTranscriptStore } from "../stores/transcript";

export function useSessionEventBridge({
	onTrustRequest,
}: {
	onTrustRequest: (req: TrustRequest) => void;
}): void {
	useEffect(() => {
		const pi = getPi();
		const conflator = new EventConflator({
			apply: (sessionId, event) => {
				useTranscriptStore.getState().applyEvent(sessionId, event, {
					isActiveViewing: useSessionsStore.getState().activeSessionId === sessionId,
				});
				if (event.type === "agent_settled") void retrySessionHistory(sessionId);
			},
		});
		const offEvent = pi.onEvent(({ sessionId, event }: { sessionId: string; event: SessionEvent }) => {
			if (event.type === "session_info_changed") {
				useSessionsStore.getState().updateSessionName(sessionId, event.name);

				useProjectsStore.getState().applySessionName(sessionId, event.name);
				return;
			}
			conflator.push(sessionId, event);
		});
		const offPermission = pi.onPermissionRequest((req) => {
			useTranscriptStore.getState().addPermission(req.sessionId, req);
		});
		const offPermissionResolved = pi.onPermissionResolved((result) => {
			useTranscriptStore.getState().resolvePermission(result.sessionId, result.requestId);
		});

		const offDialogRequest = pi.onExtensionDialogRequest((req) => {
			useTranscriptStore.getState().addExtensionDialog(req.sessionId, req);
		});
		const offDialogResolved = pi.onExtensionDialogResolved((result) => {
			useTranscriptStore.getState().resolveExtensionDialog(result.sessionId, result.requestId);
		});
		const offNotify = pi.onExtensionNotify((event) => {
			pushExtensionToast(event.level, event.message, event.extensionPath || undefined);
		});
		const offEditorText = pi.onExtensionEditorText((event) => {
			useDraftStore.getState().updateDraft(event.sessionId, (d) => ({ ...d, text: event.text }));
			useTranscriptStore.getState().markExtensionPrefill(event.sessionId, event.source ?? "");
		});
		const offTrust = pi.onTrustRequest(onTrustRequest);
		return () => {
			offEvent();
			conflator.dispose();
			offPermission();
			offPermissionResolved();
			offDialogRequest();
			offDialogResolved();
			offNotify();
			offEditorText();
			offTrust();
		};
	}, [onTrustRequest]);
}
