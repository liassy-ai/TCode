import { buildChatRows, deriveTurnChanges, deriveTurnTimings, isAgentWorking } from "@tcode/shared";
import {
	type CSSProperties,
	type MouseEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useT } from "../../i18n";
import { useEdgeFade } from "../../lib/use-edge-fade";
import { Slot } from "../../plugins/Slot";
import { UI_SLOTS } from "../../plugins/slots";
import { useSessionsStore } from "../../stores/sessions";
import { selectTranscript, useTranscriptStore } from "../../stores/transcript";
import { useUiPreferencesStore } from "../../stores/ui-preferences";
import { CenterOrb } from "./CenterOrb";
import { MessageItem } from "./MessageItem";
import { MetaGroup } from "./MetaGroup";
import {
	clampWindowStart,
	expandWindowStart,
	MOUNT_TRIGGER_PX,
	RECLAIM_PROBE_PX,
	RECLAIM_TRIGGER_PX,
	RETAIN_ABOVE_PX,
	reclaimWindowStart,
	tailWindowStart,
} from "./mount-window";
import { RetryNote } from "./RetryNote";
import { SelectionToolbar } from "./SelectionToolbar";
import { SubagentRunCard } from "./SubagentRunCard";
import { TurnDiffChip } from "./TurnDiffChip";
import { useShownWorking } from "./use-shown-working";

const BOTTOM_THRESHOLD = 48;

export function MessageList({ sessionId }: { sessionId?: string | null }) {
	const t = useT();
	const activeSessionId = useSessionsStore((s) => s.activeSessionId);
	const viewSessionId = sessionId ?? activeSessionId;
	const transcript = useTranscriptStore((s) => selectTranscript(s, viewSessionId));
	const streaming = transcript.streaming;

	const agentWorking = isAgentWorking(transcript);

	const centerOrbEnabled = useUiPreferencesStore((s) => s.centerOrbEnabled);
	const shownWorking = useShownWorking(
		agentWorking,

		Boolean(streaming?.text.trim()) || !transcript.agentActive,
		viewSessionId,
	);

	const scrollRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);

	useEdgeFade(scrollRef, "top");

	const followingRef = useRef(true);
	const lastScrollTopRef = useRef(0);
	const lastScrollHeightRef = useRef(0);

	const updateFollowing = useCallback((value: boolean) => {
		followingRef.current = value;
	}, []);

	const pinToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
		const el = scrollRef.current;
		if (el) el.scrollTo({ top: el.scrollHeight, behavior });
	}, []);

	const offBottomRef = useRef(false);
	const [offBottom, setOffBottom] = useState(false);
	const syncViewportOffBottom = useCallback((el: HTMLElement | null) => {
		if (!el) return;
		const off = el.scrollHeight - el.scrollTop - el.clientHeight > BOTTOM_THRESHOLD;
		if (off !== offBottomRef.current) {
			offBottomRef.current = off;
			setOffBottom(off);
		}
	}, []);

	useEffect(() => {
		const scroll = scrollRef.current;
		const content = contentRef.current;
		if (!scroll || !content) return;
		const observer = new ResizeObserver(() => {
			if (followingRef.current) pinToBottom();

			syncViewportOffBottom(scrollRef.current);
		});
		observer.observe(content);
		observer.observe(scroll);
		return () => observer.disconnect();
	}, [pinToBottom, syncViewportOffBottom]);

	const lastMessage = transcript.messages[transcript.messages.length - 1];
	const lastUserMessageId = lastMessage?.kind === "user" ? lastMessage.id : null;
	useEffect(() => {
		if (!lastUserMessageId) return;
		updateFollowing(true);
		pinToBottom();
		syncViewportOffBottom(scrollRef.current);
	}, [lastUserMessageId, pinToBottom, updateFollowing, syncViewportOffBottom]);

	useEffect(() => {
		updateFollowing(true);
		pinToBottom();
		syncViewportOffBottom(scrollRef.current);
	}, [viewSessionId, pinToBottom, updateFollowing, syncViewportOffBottom]);

	const handleSummaryToggle = (e: MouseEvent) => {
		const el = scrollRef.current;
		if (!el || el.scrollHeight <= el.clientHeight) return;
		if (e.target instanceof Element && e.target.closest("summary")) updateFollowing(false);
	};

	const turnChanges = useMemo(() => deriveTurnChanges(transcript.messages), [transcript.messages]);
	const turnTimings = useMemo(
		() => deriveTurnTimings(transcript.messages, transcript.runEndedAt),
		[transcript.messages, transcript.runEndedAt],
	);
	const turnBaselineRef = useRef({ sid: viewSessionId, count: 0 });
	if (turnBaselineRef.current.sid !== viewSessionId) {
		turnBaselineRef.current = { sid: viewSessionId, count: turnTimings.length };
	}
	const enteringTurn =
		turnTimings.length > turnBaselineRef.current.count
			? (turnTimings[turnTimings.length - 1]?.turnIndex ?? null)
			: null;

	const rows = useMemo(
		() =>
			buildChatRows(
				{
					messages: transcript.messages,
					streaming,
					agentActive: transcript.agentActive,
					runEndedAt: transcript.runEndedAt,
				},
				String(viewSessionId),
				Date.now(),
				{
					turnChanges,
					turnTimings,
					enteringTurn,
				},
			),
		[
			transcript.messages,
			streaming,
			transcript.agentActive,
			transcript.runEndedAt,
			viewSessionId,
			turnChanges,
			turnTimings,
			enteringTurn,
		],
	);

	const [mountFrom, setMountFrom] = useState(0);
	const viewSessionRef = useRef<string | null>(null);

	const sessionChanged = viewSessionRef.current !== viewSessionId;
	if (sessionChanged) {
		viewSessionRef.current = viewSessionId;
		setMountFrom(tailWindowStart(rows.length));
	}
	const renderedFrom = sessionChanged
		? tailWindowStart(rows.length)
		: clampWindowStart(mountFrom, rows.length);
	const renderedFromRef = useRef(renderedFrom);
	renderedFromRef.current = renderedFrom;

	const prependAnchorRef = useRef<{ el: Element; viewportTop: number } | null>(null);

	const lastReclaimProbeRef = useRef(0);

	const requestEarlierRows = () => {
		const next = expandWindowStart(renderedFromRef.current, rows.length);
		if (next === renderedFromRef.current) return;
		const anchor = contentRef.current?.firstElementChild;
		if (!anchor) return;
		const scroller = scrollRef.current;
		if (!scroller) return;
		prependAnchorRef.current = {
			el: anchor,
			viewportTop: anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
		};
		setMountFrom(next);
	};

	const reclaimEarlierRows = () => {
		const scroller = scrollRef.current;
		const content = contentRef.current;
		if (!scroller || !content) return;
		const from = renderedFromRef.current;
		const idx: number[] = [];
		rows.slice(from).forEach((row, i) => {
			if (row.kind === "turnDiff" && row.hasFinalText) return;
			idx.push(from + i);
		});
		const kids = content.children;
		const limit = Math.min(kids.length, idx.length);
		if (limit === 0) return;
		const containerTop = scroller.getBoundingClientRect().top;
		const keepLine = containerTop - RETAIN_ABOVE_PX;
		let firstKeep = limit;
		for (let i = 0; i < limit; i++) {
			const kid = kids.item(i);
			if (!kid || kid.getBoundingClientRect().bottom > keepLine) {
				firstKeep = i;
				break;
			}
		}
		if (firstKeep >= limit) return;
		const anchor = kids.item(firstKeep);
		const firstIndex = idx[firstKeep];
		if (!anchor || firstIndex === undefined) return;
		const removed = containerTop - anchor.getBoundingClientRect().top - RETAIN_ABOVE_PX;
		if (removed < RECLAIM_TRIGGER_PX - RETAIN_ABOVE_PX) return;
		const next = reclaimWindowStart(firstIndex, rows.length);
		if (next <= from) return;
		prependAnchorRef.current = {
			el: anchor,
			viewportTop: anchor.getBoundingClientRect().top - containerTop,
		};
		setMountFrom(next);
	};

	const handleScroll = () => {
		const el = scrollRef.current;
		if (!el) return;
		const heightShrank = el.scrollHeight < lastScrollHeightRef.current;
		const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD;
		if (atBottom) updateFollowing(true);
		else if (el.scrollTop < lastScrollTopRef.current && !heightShrank) updateFollowing(false);
		syncViewportOffBottom(el);
		lastScrollTopRef.current = el.scrollTop;
		lastScrollHeightRef.current = el.scrollHeight;
		if (renderedFromRef.current > 0 && el.scrollTop < MOUNT_TRIGGER_PX) requestEarlierRows();

		if (
			el.scrollTop >= lastScrollTopRef.current &&
			Math.abs(el.scrollTop - lastReclaimProbeRef.current) >= RECLAIM_PROBE_PX
		) {
			lastReclaimProbeRef.current = el.scrollTop;
			reclaimEarlierRows();
		}
	};

	useLayoutEffect(() => {
		const el = scrollRef.current;
		const pending = prependAnchorRef.current;
		prependAnchorRef.current = null;
		if (el && pending?.el.isConnected) {
			const drift = pending.el.getBoundingClientRect().top - pending.viewportTop;
			if (drift !== 0) el.scrollTop += drift;
		}
		if (el && renderedFromRef.current > 0 && el.scrollHeight <= el.clientHeight) requestEarlierRows();
	}, [renderedFrom]);

	const items: React.ReactNode[] = [];
	const visibleRows = renderedFrom > 0 ? rows.slice(renderedFrom) : rows;
	visibleRows.forEach((row) => {
		if (row.kind === "turnDiff") {
			if (row.hasFinalText) return;

			items.push(
				<div key={row.key} className={row.running || row.afterMetaGroup ? undefined : "-mt-4"}>
					<TurnDiffChip
						changes={row.changes}
						timing={row.timing}
						running={row.running}
						entering={row.entering}
					/>
				</div>,
			);
			return;
		}
		if (row.kind === "metaGroup") {
			items.push(
				<MetaGroup
					key={row.key}
					items={row.items}
					working={row.working}
					endImmediately={row.endImmediately}
					subagentCount={row.subagentCount}
				/>,
			);
			return;
		}
		if (row.kind === "streamingSubagents") {
			items.push(
				<Slot
					key={row.key}
					name={UI_SLOTS.SubagentCard}
					props={{ runs: row.runs }}
					fallback={SubagentRunCard}
				/>,
			);
			return;
		}
		const itemProps = {
			message: row.message,
			metaInGroup: row.metaInGroup,
			showActions: row.showActions,
			turnTiming: row.turnTiming,
			turnChanges: row.turnChanges,
			streaming: row.streaming,
			sessionId: viewSessionId,
		};
		items.push(<MessageItem key={row.key} {...itemProps} />);
	});

	return (
		<div className="relative h-full">
			{centerOrbEnabled && <CenterOrb visible={shownWorking} />}

			<div
				ref={scrollRef}
				onScroll={handleScroll}
				onClickCapture={handleSummaryToggle}
				style={{ "--edge-fade-size": "28px" } as CSSProperties}
				className="edge-fade relative z-10 h-full overflow-x-hidden overflow-y-auto [overflow-anchor:auto]"
			>
				<div ref={contentRef} className="mx-auto flex max-w-[760px] flex-col gap-6 px-6 pt-8 pb-16">
					{items}
					{transcript.retrying && <RetryNote info={transcript.retrying} />}
				</div>
			</div>

			<SelectionToolbar containerRef={scrollRef} />
			{offBottom && (
				<button
					type="button"
					onClick={() => {
						updateFollowing(true);
						pinToBottom(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");
					}}
					className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-surface/95 px-3 py-1.5 text-xs text-ink-2 shadow-pop backdrop-blur transition-colors hover:bg-hover"
					aria-label={t("message.scrollToBottom")}
				>
					<svg
						width="13"
						height="13"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M12 5v14" />
						<path d="m19 12-7 7-7-7" />
					</svg>
					{t("message.scrollToBottom")}
				</button>
			)}
		</div>
	);
}
