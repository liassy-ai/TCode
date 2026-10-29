import type { SidePaneTabSnapshot } from "@tcode/shared";
import { isSidePaneLiveResourceKind, SIDEPANE_MIN_WIDTH_PX } from "@tcode/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppErrorBoundary } from "../components/AppErrorBoundary";
import { SIDEBAR_WIDTH_PX } from "../components/sidebar/Sidebar";
import { useT } from "../i18n";
import { useWindowResizing } from "../lib/use-window-resizing";
import { useChatLayoutStore } from "../stores/chat-layout";
import { NEW_SESSION_DRAFT_KEY } from "../stores/drafts";
import { useSessionsStore } from "../stores/sessions";
import { useUiPreferencesStore } from "../stores/ui-preferences";
import { commitSidePaneWidth, sidebarInFlowWidthPx } from "./placement";
import { SIDEPANE_REGISTRY, SidePaneTabIcon } from "./registry";
import { SidePaneLauncher } from "./SidePaneLauncher";
import {
	dockTakesSlack,
	isDockExpanded,
	isTabVisibleInSession,
	selectActiveTabId,
	selectOwnerTabs,
	useSidePaneStore,
} from "./store";
import { sidePaneMaxWidthPx } from "./width";

const HOVER_LINE_HALF_PX = 40;

export function SidePaneDock() {
	const t = useT();
	const cwd = useSessionsStore((state) => state.cwd);
	const sessionId = useSessionsStore((state) => state.activeSessionId);

	const ownerKey = sessionId ?? NEW_SESSION_DRAFT_KEY;
	const widthPx = useSidePaneStore((state) => state.widthPx);

	const dockSlack = useSidePaneStore(dockTakesSlack);
	const floorPx = useChatLayoutStore((state) => state.floorPx);

	const windowResizing = useWindowResizing();

	const dockExpanded = useSidePaneStore((s) => isDockExpanded(s));
	const [dockOpening, setDockOpening] = useState(false);
	useEffect(() => {
		if (!dockExpanded) {
			setDockOpening(false);
			useSidePaneStore.getState().setOpening(false);
			return;
		}
		setDockOpening(true);
		useSidePaneStore.getState().setOpening(true);

		const timer = setTimeout(() => {
			setDockOpening(false);
			useSidePaneStore.getState().setOpening(false);
		}, 420);
		return () => {
			clearTimeout(timer);
			useSidePaneStore.getState().setOpening(false);
		};
	}, [dockExpanded]);

	const [dockAnimating, setDockAnimating] = useState(false);
	useEffect(() => {
		setDockAnimating(true);
		const timer = setTimeout(() => setDockAnimating(false), 420);
		return () => clearTimeout(timer);
	}, [dockExpanded]);
	const resizing = useSidePaneStore((state) => state.resizing);

	const owners = useSidePaneStore((state) => state.owners);
	const floating = useSidePaneStore((state) => state.floating);
	const ownerTabs = useSidePaneStore(selectOwnerTabs);
	const activeTabId = useSidePaneStore(selectActiveTabId);
	const setOwner = useSidePaneStore((state) => state.setOwner);
	const setResizing = useSidePaneStore((state) => state.setResizing);
	const previewWidth = useSidePaneStore((state) => state.previewWidth);
	const commitWidth = useSidePaneStore((state) => state.commitWidth);
	const dockRef = useRef<HTMLDivElement | null>(null);
	const dragOriginRef = useRef<{ clientX: number; width: number } | null>(null);

	const [rowWidth, setRowWidth] = useState(0);
	useEffect(() => {
		const row = dockRef.current?.parentElement;
		if (!row) return;
		const measure = () => setRowWidth(row.getBoundingClientRect().width);
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(row);
		return () => ro.disconnect();
	}, [cwd]);

	useEffect(() => {
		setOwner(cwd, ownerKey);
	}, [cwd, ownerKey, setOwner]);

	const expanded = useSidePaneStore(
		(state) => !!cwd && (state.owners.find((owner) => owner.sessionId === ownerKey)?.expanded ?? false),
	);

	const renderedWidth = expanded && rowWidth > 0 ? rowWidth - Math.round(rowWidth - widthPx) : widthPx;

	const sidebarCollapsed = useUiPreferencesStore((s) => s.sidebarCollapsed);
	const sidebarAutoCollapsed = useUiPreferencesStore((s) => s.autoCollapsed);
	const sidebarFloating = useUiPreferencesStore((s) => s.sidebarFloating);
	const sidebarInFlow = !sidebarCollapsed && !sidebarAutoCollapsed && !sidebarFloating;

	const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
	useEffect(() => {
		const onResize = () => setViewportWidth(window.innerWidth);
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	const floatWidth = Math.min(
		Math.max(renderedWidth, SIDEPANE_MIN_WIDTH_PX),
		Math.max(SIDEPANE_MIN_WIDTH_PX, viewportWidth - 20),
	);

	const visibleTabs = useMemo(
		() => ownerTabs.filter((tab) => isTabVisibleInSession(tab, sessionId)),
		[ownerTabs, sessionId],
	);

	const mountedTabs = useMemo(() => {
		const mounted = new Map<
			string,
			{
				tab: SidePaneTabSnapshot;
				cwd: string;
				ownerKey: string;
				sessionId: string | null;
				visible: boolean;
			}
		>();
		for (const owner of owners) {
			for (const tab of owner.tabs) {
				if (!isSidePaneLiveResourceKind(tab.kind)) continue;
				mounted.set(`${owner.sessionId}/${tab.id}`, {
					tab,
					cwd: owner.cwd,
					ownerKey: owner.sessionId,
					sessionId: owner.sessionId === NEW_SESSION_DRAFT_KEY ? null : owner.sessionId,
					visible: false,
				});
			}
		}

		const active = visibleTabs.find((tab) => tab.id === activeTabId);
		if (active && cwd) {
			mounted.set(`${ownerKey}/${active.id}`, {
				tab: active,
				cwd,
				ownerKey,
				sessionId,
				visible: false,
			});
		}
		if (expanded) {
			for (const entry of mounted.values()) {
				entry.visible = entry.ownerKey === ownerKey && entry.tab.id === activeTabId;
			}
		}
		return [...mounted.values()];
	}, [owners, visibleTabs, activeTabId, expanded, cwd, ownerKey, sessionId]);

	const maxAllowedWidth = useCallback(() => {
		const ui = useUiPreferencesStore.getState();
		const sidebarPx = ui.sidebarCollapsed || ui.autoCollapsed || ui.sidebarFloating ? 0 : SIDEBAR_WIDTH_PX;
		return sidePaneMaxWidthPx(window.innerWidth, sidebarPx, useChatLayoutStore.getState().floorPx);
	}, []);

	const startResize = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (!expanded || event.button !== 0) return;
			const rect = dockRef.current?.getBoundingClientRect();
			if (!rect) return;
			dragOriginRef.current = { clientX: event.clientX, width: rect.width };

			try {
				event.currentTarget.setPointerCapture(event.pointerId);
			} catch {}
			setResizing(true);
		},
		[expanded, setResizing],
	);

	const trackHoverY = useCallback((event: React.PointerEvent<HTMLElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();
		const y = Math.min(
			rect.height - HOVER_LINE_HALF_PX,
			Math.max(HOVER_LINE_HALF_PX, event.clientY - rect.top),
		);
		event.currentTarget.style.setProperty("--sidepane-hover-y", `${y}px`);
	}, []);

	useEffect(() => {
		if (!resizing) return;
		const maxWidth = maxAllowedWidth();
		const finish = () => {
			dragOriginRef.current = null;
			setResizing(false);

			const chatWidthPx = window.innerWidth - sidebarInFlowWidthPx() - useSidePaneStore.getState().widthPx;
			commitWidth(useSidePaneStore.getState().widthPx, chatWidthPx);
		};

		const onMove = (event: PointerEvent) => {
			if ((event.buttons & 1) === 0) {
				finish();
				return;
			}
			const origin = dragOriginRef.current;
			if (!origin) return;

			const next = origin.width + (origin.clientX - event.clientX);
			previewWidth(Math.min(maxWidth, Math.max(SIDEPANE_MIN_WIDTH_PX, next)));
		};
		const onUp = () => finish();

		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onUp);
		return () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onUp);
		};
	}, [commitWidth, maxAllowedWidth, previewWidth, resizing, setResizing]);

	const resizeBy = useCallback((delta: number) => {
		const current = useSidePaneStore.getState().widthPx;
		commitSidePaneWidth(current + delta);
	}, []);

	if (!cwd) return null;

	return (
		<>
			{(expanded || dockAnimating) && !floating && (
				<span
					aria-hidden="true"
					className="sidepane-shell-rule"
					data-resizing={resizing || windowResizing ? "true" : "false"}
					style={{ right: (expanded ? renderedWidth : 0) + "px", opacity: expanded ? 1 : 0 }}
				/>
			)}
			{floating && expanded && (
				<button
					type="button"
					tabIndex={-1}
					aria-label={t("sidepane.backdrop")}
					className="absolute inset-y-0 right-0 z-30 cursor-default"
					style={{ left: sidebarInFlow ? SIDEBAR_WIDTH_PX : 0 }}
					onClick={() => useSidePaneStore.getState().collapse()}
				/>
			)}
			<div
				ref={dockRef}
				data-resizing={resizing ? "true" : "false"}
				data-window-resizing={windowResizing ? "true" : "false"}
				className={`sidepane-dock relative flex min-h-0 shrink-0 flex-col overflow-hidden bg-surface ${
					floating ? "is-floating" : ""
				} ${floating && !expanded ? "is-collapsed" : ""}`}
				style={{
					width: floating ? floatWidth + "px" : expanded ? renderedWidth + "px" : "0px",

					...(dockSlack && !dockOpening
						? {
								flexGrow: 999,
								minWidth: SIDEPANE_MIN_WIDTH_PX + "px",
								maxWidth:
									"min(66.6%, calc(100% - " +
									(sidebarInFlow ? SIDEBAR_WIDTH_PX : 0) +
									"px - " +
									floorPx +
									"px))",
							}
						: null),
				}}
				aria-hidden={!expanded}
			>
				{expanded && (
					<hr
						aria-orientation="vertical"
						aria-label={t("sidepane.resize")}
						aria-valuenow={widthPx}
						aria-valuemin={SIDEPANE_MIN_WIDTH_PX}
						aria-valuemax={maxAllowedWidth()}
						tabIndex={0}
						onPointerDown={startResize}
						onPointerEnter={trackHoverY}
						onPointerMove={trackHoverY}
						onKeyDown={(event) => {
							if (event.key === "ArrowLeft") {
								event.preventDefault();
								resizeBy(24);
							} else if (event.key === "ArrowRight") {
								event.preventDefault();
								resizeBy(-24);
							}
						}}
						className="sidepane-resize-handle absolute left-0 top-0 z-10 m-0 h-full w-1 cursor-col-resize appearance-none border-none bg-transparent outline-none focus-visible:bg-hover"
					/>
				)}

				<div className={`relative z-0 min-h-0 flex-1 overflow-hidden ${expanded ? "sidepane-fade-in" : ""}`}>
					{expanded && visibleTabs.length === 0 && <SidePaneLauncher mode="empty" cwd={cwd} />}
					{mountedTabs.map((entry) => (
						<SidePanePanelHost
							key={`${entry.ownerKey}/${entry.tab.id}`}
							tab={entry.tab}
							cwd={entry.cwd}
							sessionId={entry.sessionId}
							visible={entry.visible}
						/>
					))}
				</div>
			</div>
		</>
	);
}

function SidePanePanelHost({
	tab,
	cwd,
	sessionId,
	visible,
}: {
	tab: SidePaneTabSnapshot;
	cwd: string;
	sessionId: string | null;
	visible: boolean;
}) {
	const t = useT();
	const meta = SIDEPANE_REGISTRY[tab.kind];
	const Panel = meta.panel;

	const live = isSidePaneLiveResourceKind(tab.kind);

	return (
		<div
			className={`absolute inset-0 ${
				visible
					? "sidepane-fade-in"
					: live
						? "pointer-events-none opacity-0"
						: "pointer-events-none invisible"
			}`}
			aria-hidden={!visible}
		>
			<AppErrorBoundary>
				{Panel ? (
					<Panel tab={tab} cwd={cwd} sessionId={sessionId} visible={visible} t={t} />
				) : (
					<SidePanePendingPanel kind={tab.kind} t={t} />
				)}
			</AppErrorBoundary>
		</div>
	);
}

function SidePanePendingPanel({
	kind,
	t,
}: {
	kind: SidePaneTabSnapshot["kind"];
	t: ReturnType<typeof useT>;
}) {
	const meta = SIDEPANE_REGISTRY[kind];
	return (
		<div className="flex h-full flex-col items-center justify-center gap-2 bg-surface px-6 text-center">
			<SidePaneTabIcon kind={kind} size={18} className="text-ink-faint" />
			<div className="text-[13px] font-medium text-ink-2">{t(meta.labelKey)}</div>
			<div className="text-[12px] leading-relaxed text-ink-dim">{t("sidepane.pending.body")}</div>
			{meta.blockedOn && <div className="text-[12px] text-ink-faint">{t(meta.blockedOn)}</div>}
		</div>
	);
}
