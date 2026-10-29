import { useTranscriptStore } from "../../stores/transcript";
import { Composer } from "../composer/Composer";
import { ApprovalDock } from "./ApprovalDock";
import { InteractionDock } from "./InteractionDock";

export function DockSlot({ sessionId, hideComposer }: { sessionId: string | null; hideComposer: boolean }) {
	const permission = useTranscriptStore((s) =>
		sessionId ? s.bySession[sessionId]?.pendingPermissions[0] : undefined,
	);
	const dialog = useTranscriptStore((s) =>
		sessionId ? s.bySession[sessionId]?.pendingDialogs[0] : undefined,
	);
	if (permission) return <ApprovalDock sessionId={sessionId} />;
	if (dialog) return <InteractionDock sessionId={sessionId} />;
	if (hideComposer) return null;

	return (
		<div className="approval-composer-enter relative z-20">
			<Composer />
		</div>
	);
}
