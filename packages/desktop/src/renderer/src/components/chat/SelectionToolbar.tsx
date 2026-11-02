import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionBusy, useSessionReadOnly } from "../../hooks/use-session-state";
import { useT } from "../../i18n";
import { COMPOSER_FOCUS_EVENT, useDraftStore } from "../../stores/drafts";
import { useSessionsStore } from "../../stores/sessions";
import { useTranscriptStore } from "../../stores/transcript";

const GAP = 8;

const HALF_WIDTH = 120;

interface SelectionState {
	text: string;
	rect: DOMRect;
}

export function SelectionToolbar({ containerRef }: { containerRef: React.RefObject<HTMLDivElement | null> }) {
	const t = useT();
	const activeSessionId = useSessionsStore((s) => s.activeSessionId);
	const readOnly = useSessionReadOnly();
	const busy = useSessionBusy(activeSessionId);
	const [pending, setPending] = useState<SelectionState | null>(null);
	const [visible, setVisible] = useState(false);
	const [forking, setForking] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);
	const visibleRef = useRef(false);

	const [above, setAbove] = useState(true);

	visibleRef.current = visible;

	const hide = useCallback(() => {
		setVisible(false);
		setPending(null);
	}, []);

	const ownsSelection = useCallback(() => {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
		const container = containerRef.current;
		const menu = menuRef.current;
		const node = sel.anchorNode;
		if (!node || !container?.contains(node) || menu?.contains(node)) return null;
		const text = sel.toString().trim();
		if (!text) return null;
		return { text, rect: sel.getRangeAt(0).getBoundingClientRect() };
	}, [containerRef]);

	useEffect(() => {
		if (readOnly) return;
		const onChange = () => {
			const owned = ownsSelection();
			if (!owned) {
				if (visibleRef.current) hide();
				return;
			}
			setPending(owned);
		};
		document.addEventListener("selectionchange", onChange);
		return () => document.removeEventListener("selectionchange", onChange);
	}, [readOnly, ownsSelection, hide]);

	useEffect(() => {
		if (readOnly) return;
		let raf = 0;
		const syncPosition = () => {
			const owned = ownsSelection();
			if (!owned) {
				hide();
				return;
			}
			setPending(owned);
		};
		const onMouseUp = () => {
			const owned = ownsSelection();
			if (!owned) return;

			setAbove(owned.rect.top > 120);
			setPending(owned);
			setVisible(true);
		};
		const onPointerDown = (e: PointerEvent) => {
			if (!visibleRef.current) return;
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) hide();
		};
		const onScroll = () => {
			if (!visibleRef.current) return;
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(syncPosition);
		};
		document.addEventListener("mouseup", onMouseUp);
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("scroll", onScroll, true);
		window.addEventListener("resize", onScroll);
		return () => {
			cancelAnimationFrame(raf);
			document.removeEventListener("mouseup", onMouseUp);
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("scroll", onScroll, true);
			window.removeEventListener("resize", onScroll);
		};
	}, [readOnly, ownsSelection, hide]);

	useEffect(() => {
		hide();
	}, [activeSessionId, hide]);

	const consume = useCallback(() => {
		window.getSelection()?.removeAllRanges();
		hide();
	}, [hide]);

	const addToChat = () => {
		if (!pending || !activeSessionId) return;

		useDraftStore
			.getState()
			.updateDraft(activeSessionId, (d) =>
				d.quotes.includes(pending.text) ? d : { ...d, quotes: [...d.quotes, pending.text] },
			);
		window.dispatchEvent(new CustomEvent(COMPOSER_FOCUS_EVENT));
		consume();
	};

	const continueInNewChat = async () => {
		if (!pending || busy || forking || !activeSessionId) return;
		const messages = useTranscriptStore.getState().bySession[activeSessionId]?.messages ?? [];
		const lastAssistant = [...messages].reverse().find((m) => m.kind === "assistant");
		if (!lastAssistant) return;
		const quote = pending.text;
		const ref = lastAssistant.entryId
			? { entryId: lastAssistant.entryId }
			: { text: lastAssistant.sourceText ?? lastAssistant.text };
		setForking(true);
		try {
			const newId = await useSessionsStore.getState().forkSession(ref);
			if (!newId) return;
			useDraftStore.getState().updateDraft(newId, (d) => ({ ...d, quotes: [...d.quotes, quote] }));
			window.dispatchEvent(new CustomEvent(COMPOSER_FOCUS_EVENT));
			consume();
		} finally {
			setForking(false);
		}
	};

	if (!visible || !pending || readOnly) return null;
	const { rect } = pending;
	const left = Math.min(
		Math.max(rect.left + rect.width / 2, HALF_WIDTH + 8),
		window.innerWidth - HALF_WIDTH - 8,
	);

	const top = Math.min(Math.max(above ? rect.top - GAP : rect.bottom + GAP, 8), window.innerHeight - 48);

	return (
		<div
			ref={menuRef}
			role="menu"
			className="selection-pop fixed z-50 flex items-center gap-0.5 rounded-xl bg-surface p-1 shadow-pop"
			style={{
				left,
				top,
				transform: `translate(-50%, ${above ? "-100%" : "0"})`,
			}}
			onMouseDown={(e) => e.preventDefault()}
		>
			<button type="button" role="menuitem" className="selection-menu-btn" onClick={addToChat}>
				{t("selection.addToChat")}
			</button>
			<span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-border" />
			<button
				type="button"
				role="menuitem"
				className="selection-menu-btn disabled:opacity-40"
				disabled={busy || forking}
				title={busy ? t("selection.busyHint") : undefined}
				onClick={() => void continueInNewChat()}
			>
				{t("selection.continueNew")}
			</button>
		</div>
	);
}
