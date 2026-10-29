import { useEffect, useRef, useState } from "react";
import { useContextUsage } from "../../hooks/use-context-usage";
import { useSessionModelStats } from "../../hooks/use-session-cache-share";
import { useActiveModelInfo, useThinkingLevelState } from "../../hooks/use-session-state";
import { useT } from "../../i18n";
import { useSessionsStore } from "../../stores/sessions";
import { selectTranscript, useTranscriptStore } from "../../stores/transcript";

export function ContextRing() {
	const t = useT();
	const activeSessionId = useSessionsStore((s) => s.activeSessionId);
	const hasMessages = useTranscriptStore((s) => selectTranscript(s, activeSessionId).messages.length > 0);

	const activeModel = useActiveModelInfo();
	const { effective: thinkingLevel } = useThinkingLevelState();
	const modelKey = activeModel ? `${activeModel.provider}/${activeModel.id}/${thinkingLevel}` : "";
	const usage = useContextUsage(activeSessionId, modelKey);
	const { share, entry } = useSessionModelStats(activeSessionId, activeModel ?? null);
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		window.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	if (!usage || usage.percent == null || !hasMessages) return null;

	const pct = Math.max(0, Math.min(100, usage.percent));
	const color = pct < 60 ? "stroke-ink-faint" : pct < 85 ? "stroke-amber-500" : "stroke-red-500";
	const barColor = pct < 60 ? "bg-ink-faint" : pct < 85 ? "bg-amber-500" : "bg-red-500";
	const r = 7;
	const c = 2 * Math.PI * r;
	const row = (label: string, value: number | undefined) => (
		<div className="flex items-center justify-between text-[11px] leading-5">
			<span className="text-ink-dim">{label}</span>
			<span className="font-mono tabular-nums text-ink-2">
				{value === undefined ? "—" : formatTokens(value)}
			</span>
		</div>
	);

	return (
		<div ref={ref} className="group relative -mr-1.5 flex h-7 items-center">
			<button
				type="button"
				className="flex items-center gap-1"
				aria-label={`${usage.percent.toFixed(0)}%`}
				onClick={() => setOpen((v) => !v)}
			>
				<svg width="17" height="17" viewBox="0 0 20 20" className="-rotate-90" role="img" aria-hidden="true">
					<circle cx="10" cy="10" r={r} className="fill-none stroke-border" strokeWidth="2.5" />
					<circle
						cx="10"
						cy="10"
						r={r}
						className={`fill-none ${color} transition-colors`}
						strokeWidth="2.5"
						strokeLinecap="round"
						strokeDasharray={`${(pct / 100) * c} ${c}`}
					/>
				</svg>
			</button>
			<div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 rounded-md border border-border bg-surface px-2 py-1 text-[11px] whitespace-nowrap text-ink-2 opacity-0 shadow-pop transition-opacity group-hover:opacity-100">
				{formatTokens(usage.tokens ?? 0)} / {formatTokens(usage.contextWindow)} tokens · {pct.toFixed(0)}%
				{share !== null ? ` · ${t("composer.cacheHit")} ${share.toFixed(1)}%` : ""}
			</div>
			{open && (
				<div className="pointer-events-auto absolute bottom-full left-1/2 z-30 mb-1.5 w-72 -translate-x-1/2 rounded-lg border border-border bg-surface p-2 shadow-pop">
					<div className="mb-0.5 flex items-center justify-between text-[11px] font-medium text-ink-2">
						<span>{t("composer.contextOccupancy")}</span>
						<span className="tabular-nums text-ink-dim">
							{formatTokens(usage.tokens ?? 0)} / {formatTokens(usage.contextWindow)} tokens ·{" "}
							{pct.toFixed(0)}%
						</span>
					</div>
					<div className="mb-2 h-1 overflow-hidden rounded-full bg-border/60">
						<div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
					</div>
					<div className="mb-0.5 text-[11px] font-medium text-ink-2">
						{activeModel?.label ?? t("composer.modelSessionData")}
					</div>
					{row(t("composer.statInput"), entry?.inputTokens)}
					{row(t("composer.statOutput"), entry?.outputTokens)}
					{share !== null && (
						<div className="flex items-center justify-between text-[11px] leading-5">
							<span className="text-ink-dim">{t("composer.cacheHit")}</span>
							<span className="font-mono tabular-nums text-ink-2">{share.toFixed(1)}%</span>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

export function formatTokens(n: number): string {
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
}
