import { useSessionsStore, useTranscriptStore } from "@tcode/plugin-api";
import { memo } from "react";

const petCss = `
@keyframes pet-breathe {
	0%, 100% { transform: scale(1); }
	50% { transform: scale(1.14); }
}
.pet-breathe { animation: pet-breathe 2.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
	.pet-breathe { animation: none; }
}`;

export const Pet = memo(function Pet() {
	const activeSessionId = useSessionsStore((s) => s.activeSessionId);
	const agentActive = useTranscriptStore((s) =>
		activeSessionId ? (s.bySession[activeSessionId]?.agentActive ?? false) : false,
	);
	return (
		<>
			<style>{petCss}</style>
			<div className="pointer-events-auto flex flex-col items-center gap-1.5">
				<div
					className={`flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface text-[20px] shadow-soft ${
						agentActive ? "pet-breathe" : ""
					}`}
				>
					🐾
				</div>
				<span className="rounded-full bg-surface px-2 py-0.5 text-[10px] text-ink-dim shadow-soft">
					{agentActive ? "working…" : "idle"}
				</span>
			</div>
		</>
	);
});
