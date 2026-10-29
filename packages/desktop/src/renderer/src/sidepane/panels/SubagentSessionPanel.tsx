import { useEffect, useState } from "react";
import { MessageList } from "../../components/chat/MessageList";
import { useSessionsStore } from "../../stores/sessions";
import { selectTranscript, useTranscriptStore } from "../../stores/transcript";
import type { SidePanePanelProps } from "../panelProps";

export function SubagentSessionPanel({ tab, t }: SidePanePanelProps) {
	const file = tab.payload.file ?? "";

	const storeSessionId = useSessionsStore(
		(s) => s.sessions.find((x) => x.sessionFile === file)?.sessionId ?? null,
	);
	const storeHasRows = useTranscriptStore((s) =>
		storeSessionId ? selectTranscript(s, storeSessionId).messages.length > 0 : false,
	);

	const [inspectedId, setInspectedId] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		if (!file) return;
		let cancelled = false;
		setFailed(false);

		void useSessionsStore
			.getState()
			.inspectSession(file)
			.then((meta) => {
				if (cancelled) return;
				if (meta?.sessionId) setInspectedId(meta.sessionId);
				else if (!storeSessionId) setFailed(true);
			});
		return () => {
			cancelled = true;
		};
	}, [file, storeSessionId]);

	const viewSessionId = storeHasRows ? storeSessionId : (inspectedId ?? storeSessionId);

	if (!viewSessionId) {
		return (
			<div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-ink-faint">
				{failed && !inspectedId
					? t("sidepane.subagentSession.failed")
					: t("sidepane.subagentSession.loading")}
			</div>
		);
	}
	return <MessageList sessionId={viewSessionId} />;
}
