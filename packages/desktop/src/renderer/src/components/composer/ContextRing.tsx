import { useCallback, useEffect, useRef, useState } from "react";
import { getPi } from "../../api";
import { useContextUsage } from "../../hooks/use-context-usage";
import { useSessionModelStats } from "../../hooks/use-session-cache-share";
import { useActiveModelInfo, useThinkingLevelState } from "../../hooks/use-session-state";
import { useT } from "../../i18n";
import { useDraftPolishStore } from "../../stores/draft-polish";
import { COMPOSER_FOCUS_EVENT, NEW_SESSION_DRAFT_KEY, useDraftStore } from "../../stores/drafts";
import { useSessionsStore } from "../../stores/sessions";
import { pushToast } from "../../stores/toasts";
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
	const rootRef = useRef<HTMLDivElement>(null);
	const openTimerRef = useRef<number | null>(null);
	const longPressRef = useRef<number | null>(null);

	const cancelOpenTimer = useCallback(() => {
		if (openTimerRef.current !== null) {
			window.clearTimeout(openTimerRef.current);
			openTimerRef.current = null;
		}
	}, []);

	const cancelLongPress = useCallback(() => {
		if (longPressRef.current !== null) {
			window.clearTimeout(longPressRef.current);
			longPressRef.current = null;
		}
	}, []);

	const draftKey = useSessionsStore((s) => s.activeSessionId) ?? NEW_SESSION_DRAFT_KEY;
	const draftText = useDraftStore((s) => s.bySession[draftKey]?.text ?? "");
	const polishing = useDraftPolishStore((s) => s.polishing);
	const setPolishing = useDraftPolishStore((s) => s.setPolishing);
	const hasDraftText = draftText.trim().length > 0;

	const polish = async () => {
		const source = useDraftStore.getState().bySession[draftKey]?.text?.trim() ?? "";
		if (!source || polishing) return;
		(document.activeElement as HTMLElement | null)?.blur();
		setPolishing(true);
		try {
			const result = await getPi().polishDraft({ sessionId: activeSessionId ?? undefined, text: source });
			if (result.text) {
				useDraftStore.getState().updateDraft(draftKey, (d) => ({ ...d, text: result.text }));
			}
		} catch (error) {
			pushToast("warning", "toast.polishFailed");
			console.error("[context-ring] 润色失败", error);
		} finally {
			setPolishing(false);
			window.dispatchEvent(new CustomEvent(COMPOSER_FOCUS_EVENT));
		}
	};

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		window.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	useEffect(
		() => () => {
			cancelOpenTimer();
			cancelLongPress();
		},
		[cancelOpenTimer, cancelLongPress],
	);

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
		<div
			ref={rootRef}
			className="relative -mr-1.5 flex h-7 items-center"
			onPointerEnter={(event) => {
				if (event.pointerType !== "mouse" || hasDraftText) return;
				cancelOpenTimer();
				openTimerRef.current = window.setTimeout(() => setOpen(true), 1000);
			}}
			onPointerLeave={() => {
				cancelOpenTimer();
				setOpen(false);
			}}
		>
			<button
				type="button"
				className={`flex items-center gap-1 transition-opacity ${polishing ? "opacity-40" : ""}`}
				disabled={polishing}
				aria-label={`${usage.percent.toFixed(0)}%`}
				onPointerDown={(event) => {
					if (event.pointerType !== "touch") return;
					cancelLongPress();
					longPressRef.current = window.setTimeout(() => setOpen(true), 400);
				}}
				onPointerUp={cancelLongPress}
				onPointerMove={cancelLongPress}
				onPointerCancel={cancelLongPress}
				onPointerLeave={cancelLongPress}
				onFocus={(event) => {
					if (event.currentTarget.matches(":focus-visible")) setOpen(true);
				}}
				onClick={(event) => {
					cancelOpenTimer();
					if (open) {
						event.currentTarget.blur();
						setOpen(false);
						return;
					}
					if (hasDraftText) void polish();
				}}
				onContextMenu={(event) => event.preventDefault()}
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
			{}
			<div
				className={`absolute bottom-full left-1/2 z-30 mb-1.5 w-72 -translate-x-1/2 rounded-lg border border-border bg-surface p-2 shadow-pop transition-opacity duration-150 ${
					open ? "pointer-events-auto visible opacity-100" : "pointer-events-none invisible opacity-0"
				}`}
			>
				<div className="mb-0.5 flex items-center justify-between text-[11px] font-medium text-ink-2">
					<span>{t("composer.contextOccupancy")}</span>
					<span className="tabular-nums text-ink-dim">
						{formatTokens(usage.tokens ?? 0)} / {formatTokens(usage.contextWindow)} tokens · {pct.toFixed(0)}%
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
		</div>
	);
}

export function formatTokens(n: number): string {
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
}
