import type { ReactNode } from "react";
import { useT } from "../../i18n";
import { sessionAvatarClass } from "../session/session-status";

export function AgentBubble({
	name,
	status,
	onAvatarClick,
	children,
}: {
	name: string;
	status?: "running" | "done" | "error";
	onAvatarClick?: () => void;
	children: ReactNode;
}) {
	const t = useT();
	const running = status === "running";
	const statusLabel =
		status === "running"
			? t("message.subagent.running")
			: status === "error"
				? t("message.subagent.failed")
				: status === "done"
					? t("message.subagent.done")
					: null;
	return (
		<div className="flex items-start gap-2.5">
			<button
				type="button"
				onClick={onAvatarClick}
				disabled={!onAvatarClick}
				title={t("message.agent.openDetail")}
				aria-label={t("message.agent.openDetail")}
				className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[12px] font-semibold ${sessionAvatarClass(
					running ? "working" : "idle",
					{ isActive: true, daily: false },
				)} ${onAvatarClick ? "cursor-pointer transition hover:ring-2 hover:ring-ink/20" : "cursor-default"}`}
			>
				{(name.charAt(0) || "?").toUpperCase()}
			</button>
			<div className="min-w-0 max-w-[85%] flex-1">
				<div className="mb-1 flex items-center gap-2 text-[12px] leading-none">
					<span className="font-medium text-ink">{name}</span>
					{statusLabel && <span className="text-ink-faint">{statusLabel}</span>}
				</div>

				<div className="agent-bubble w-fit max-w-full rounded-2xl rounded-tl-md bg-bubble px-4 py-2.5 text-[15px] leading-[1.7] text-ink">
					{children}
				</div>
			</div>
		</div>
	);
}
