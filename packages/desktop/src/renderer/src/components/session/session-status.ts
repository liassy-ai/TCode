import type { SessionMeta } from "@tcode/shared";
import { isDailyCwd } from "../../lib/daily";
import { useTranscriptStore } from "../../stores/transcript";

export type SessionStatus = "attention" | "working" | "done" | "idle";

export function useSessionStatus(sessionId: string): SessionStatus {
	return useTranscriptStore((s): SessionStatus => {
		const entry = s.bySession[sessionId];
		if (!entry) return "idle";

		if (entry.pendingPermissions.length > 0 || entry.pendingDialogs.length > 0) return "attention";
		if (entry.agentActive) return "working";
		if (entry.unseenCompletion) return "done";
		return "idle";
	});
}

export function sessionTitle(session: SessionMeta, untitledLabel: string, dailyLabel?: string): string {
	return (
		session.name ??
		(isDailyCwd(session.cwd) ? dailyLabel : undefined) ??
		session.cwd.split("/").filter(Boolean).pop() ??
		untitledLabel
	);
}

export function sessionProjectDir(session: SessionMeta): string {
	return session.cwd.split("/").filter(Boolean).pop() ?? "";
}

export function sessionLetter(session: SessionMeta): string {
	return sessionProjectDir(session)[0] ?? "P";
}

export function sessionAvatarClass(
	status: SessionStatus,
	{ isActive, daily, readOnly = false }: { isActive: boolean; daily: boolean; readOnly?: boolean },
): string {
	if (readOnly) return "bg-accent text-on-accent";
	if (status === "attention") return "bg-amber-500 text-on-ink";
	if (status === "working") return "bg-ink text-on-ink tab-avatar-working";
	if (daily) return "border border-border-strong bg-canvas text-ink";
	return isActive ? "bg-ink text-on-ink" : "bg-ink-faint text-on-ink";
}
