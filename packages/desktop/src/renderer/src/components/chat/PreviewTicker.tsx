import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import { type ActivityTickerSnapshot, createActivityTicker } from "./activity-ticker";
import { StreamingMarquee } from "./StreamingMarquee";
import { displayName } from "./tool-label";

export type LivePreviewItem =
	| { kind: "thinking"; id: string; text: string }
	| { kind: "tool"; id: string; name: string; text: string };

type CurrentSlot = LivePreviewItem;

function ThinkingPreviewRow({ text, active }: { text: string; active: boolean }) {
	return (
		<div className="flex min-w-0 items-center py-0.5 text-[13px] text-ink-dim">
			<StreamingMarquee text={text} active={active} />
		</div>
	);
}

function ToolPreviewRow({ name, text, active }: { name: string; text: string; active: boolean }) {
	const t = useT();
	return (
		<div className="flex min-w-0 items-center gap-2 py-0.5">
			<span data-shimmer-name className="sweep-target shrink-0 font-mono text-[13px] text-ink-working">
				{displayName(name, t)}
			</span>
			{text && <StreamingMarquee text={text} active={active} />}
		</div>
	);
}

function rowOf(slot: CurrentSlot, active: boolean) {
	return slot.kind === "tool" ? (
		<ToolPreviewRow name={slot.name} text={slot.text} active={active} />
	) : (
		<ThinkingPreviewRow text={slot.text} active={active} />
	);
}

const ANIMATION_MS = 320;

const PREV_CLEANUP_MS = ANIMATION_MS + 60;

export function PreviewTicker({
	items,
	reserveSpace = false,
}: {
	items: LivePreviewItem[];
	reserveSpace?: boolean;
}) {
	const [ticker] = useState(createActivityTicker);
	const [snap, setSnap] = useState<ActivityTickerSnapshot>(() => ticker.peek());
	const [shown, setShownState] = useState<CurrentSlot | null>(null);
	const [previous, setPrevious] = useState<CurrentSlot | null>(null);
	const shownRef = useRef<CurrentSlot | null>(null);
	const desiredRef = useRef<CurrentSlot | null>(null);

	const animUntilRef = useRef(0);

	const slots = useMemo(() => items.map((item) => ({ id: item.id, kind: item.kind })), [items]);

	useEffect(() => {
		const next = ticker.ingest(slots, Date.now());
		setSnap((current) =>
			current.currentId === next.currentId && current.switchAt === next.switchAt ? current : next,
		);
	}, [slots]);

	useEffect(() => {
		if (!snap.switchAt) return;
		const delay = Math.max(0, snap.switchAt - Date.now());
		const timer = setTimeout(() => setSnap(ticker.tick(Date.now())), delay);
		return () => clearTimeout(timer);
	}, [snap]);

	const live = snap.currentId ? items.find((item) => item.id === snap.currentId) : undefined;
	const desired = live ?? null;
	desiredRef.current = desired;

	const commit = (next: CurrentSlot | null) => {
		const current = shownRef.current;
		if (current && current.id !== next?.id) setPrevious(current);
		animUntilRef.current = Date.now() + ANIMATION_MS;
		shownRef.current = next;
		setShownState(next);
	};

	useLayoutEffect(() => {
		const current = shownRef.current;
		if (desired && desired.id === current?.id) {
			if (
				desired.kind !== current.kind ||
				desired.text !== current.text ||
				(desired.kind === "tool" && current.kind === "tool" && desired.name !== current.name)
			) {
				shownRef.current = desired;
				setShownState(desired);
			}
			return;
		}
		if (desired === null && current === null) return;
		const wait = animUntilRef.current - Date.now();
		if (wait <= 0) {
			commit(desired);
			return;
		}
		const timer = setTimeout(() => commit(desiredRef.current), wait);
		return () => clearTimeout(timer);
	}, [desired]);

	useEffect(() => {
		if (!previous) return;
		const timer = setTimeout(() => setPrevious(null), PREV_CLEANUP_MS);
		return () => clearTimeout(timer);
	}, [previous]);

	if (!shown && !previous) return reserveSpace ? <div className="relative h-6 overflow-hidden" /> : null;

	return (
		<div className="relative h-6 overflow-hidden text-ink-dim [mask-image:linear-gradient(to_bottom,transparent,black_20%,black_80%,transparent)]">
			{previous && (
				<div key={`prev-${previous.id}`} className="preview-slide-out absolute inset-x-0 top-0">
					{rowOf(previous, false)}
				</div>
			)}
			{shown && (
				<div key={`cur-${shown.id}`} className="preview-slide-in absolute inset-x-0 top-0">
					{rowOf(shown, true)}
				</div>
			)}
		</div>
	);
}
