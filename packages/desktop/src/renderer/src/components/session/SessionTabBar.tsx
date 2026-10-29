import type { DragEndEvent, Modifier } from "@dnd-kit/core";
import { closestCenter, DndContext, DragOverlay, KeyboardSensor, useSensor, useSensors } from "@dnd-kit/core";
import { restrictToHorizontalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import {
	horizontalListSortingStrategy,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
} from "@dnd-kit/sortable";
import type { SessionMeta } from "@tcode/shared";
import type { ComponentProps } from "react";
import { useCallback, useEffect, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { HoldToDragSensor } from "../../lib/hold-drag";
import { prefersReducedMotion, useListShift } from "../../lib/use-list-shift";
import { useLongPress } from "../../lib/use-long-press";
import { useWorkspaceRemoval } from "../../lib/workspace-actions";
import { sidePaneFloatsWhenOpen } from "../../sidepane/placement";
import { SidePaneTabStrip } from "../../sidepane/SidePaneTabStrip";
import {
	isDockExpanded,
	isTabVisibleInSession,
	selectActiveTabId,
	selectOwnerTabs,
	useSidePaneStore,
} from "../../sidepane/store";
import { useProjectsStore } from "../../stores/projects";
import {
	resolveActiveSessionMeta,
	resolveWorkspaceSessions,
	useSessionWorkspaceStore,
	type WorkspaceMember,
} from "../../stores/session-workspace";
import { useSessionsStore } from "../../stores/sessions";
import { useTranscriptStore } from "../../stores/transcript";
import { selectSidebarHidden, useUiPreferencesStore } from "../../stores/ui-preferences";
import { CloseIcon, PanelLeftIcon, PanelRightIcon, PinIcon } from "../icons";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import type { MenuAnchor } from "../ui/place-menu";
import { RenamePopover } from "./RenamePopover";
import { SessionAvatar } from "./SessionAvatar";
import { canOpenSessionMenu, renameSession, sessionMenuItems } from "./session-menu";
import { sessionTitle, useSessionStatus } from "./session-status";

const SORT_EASE = "cubic-bezier(0.2, 0, 0, 1)";

const SIDE_PANE_REGION_MIN_PX = 160;

const TOPBAR_LEFT_RESERVE_PX = 156;

const DRAG_MODIFIERS: Modifier[] = [restrictToHorizontalAxis, restrictToParentElement];

const DROP_ANIMATION = { duration: 180, easing: SORT_EASE };

function anchorOfElement(el: Element): MenuAnchor {
	const rect = el.getBoundingClientRect();
	return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function setDraggingCursor(on: boolean): void {
	document.documentElement.classList.toggle("tab-dragging-cursor", on);
}

interface AnchorState {
	sessionId: string;
	anchor: MenuAnchor;
}

function TabPill({
	session,
	isActive,
	ghost = false,
	hidden = false,
	ghostWidth,
	contextOpen = false,
	onRemove,
	buttonProps,
}: {
	session: SessionMeta;
	isActive: boolean;

	ghost?: boolean;

	hidden?: boolean;

	ghostWidth?: number | null;

	contextOpen?: boolean;

	onRemove?: () => void;
	buttonProps?: ComponentProps<"button">;
}) {
	const t = useT();

	const pinned = useUiPreferencesStore((s) => s.pinnedSessions.includes(session.sessionId));

	const status = useSessionStatus(session.sessionId);
	return (
		<button
			type="button"
			{...buttonProps}
			data-hold-drag=""
			style={{
				touchAction: "pan-x",
				...(ghost ? { width: ghostWidth ?? 208 } : null),
				...(hidden ? { opacity: 0 } : null),
			}}
			className={`no-drag tab-pill group relative flex ${ghost ? "" : "w-full"} cursor-pointer items-center gap-2 rounded-full px-2.5 py-1.5 text-sm ${
				contextOpen
					? "bg-hover text-ink"
					: isActive
						? "bg-bubble text-ink"
						: "text-ink-dim hover:bg-hover hover:text-ink"
			} ${ghost ? "tab-dragging" : ""}`}
			onClick={ghost ? undefined : buttonProps?.onClick}
		>
			{pinned && !session.readOnly && (
				<span className="flex shrink-0 text-ink-faint" aria-hidden="true">
					<PinIcon size={11} />
				</span>
			)}
			<SessionAvatar session={session} status={status} isActive={isActive} dotRing="ring-canvas" />
			<span className="relative min-w-0 flex-1">
				<span className="block truncate text-left">
					{sessionTitle(session, t("tabbar.untitled"), t("projects.daily"))}
				</span>
				{!ghost && onRemove && (
					<>
						<span
							aria-hidden="true"
							className={`pointer-events-none invisible absolute inset-y-0 right-0 w-7 bg-gradient-to-l to-transparent opacity-0 transition-opacity group-hover:visible group-hover:opacity-100 ${
								isActive ? "from-bubble" : "from-hover"
							}`}
						/>
						<span
							className="invisible absolute right-0 top-1/2 -translate-y-1/2 p-1 text-ink-dim opacity-0 transition-opacity hover:text-ink group-hover:visible group-hover:opacity-100"
							aria-hidden="true"
							title={t("tabbar.removeFromWorkspace")}
							onClick={(e) => {
								e.stopPropagation();
								onRemove?.();
							}}
						>
							<CloseIcon />
						</span>
					</>
				)}
			</span>
		</button>
	);
}

function SessionTab({
	session,
	member,
	isActive,
	contextOpen,
	onContextMenu,
	onRemove,
	sortable,
}: {
	session: SessionMeta;

	member: WorkspaceMember;
	isActive: boolean;

	contextOpen: boolean;
	onContextMenu: (sessionId: string, anchor: MenuAnchor) => void;

	onRemove?: (member: WorkspaceMember) => void;

	sortable: boolean;
}) {
	const openSession = useProjectsStore((s) => s.openSession);
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: session.sessionId,

		disabled: !sortable,
		transition: prefersReducedMotion() ? null : { duration: 220, easing: SORT_EASE },
	});

	const {
		onPointerDown: longPressDown,
		onPointerMove: longPressMove,
		onPointerUp: longPressUp,
		onPointerCancel: longPressCancel,
		cancel: cancelLongPress,
	} = useLongPress((_point, el) => {
		if (el) onContextMenu(session.sessionId, anchorOfElement(el));
	});
	useEffect(() => {
		if (isDragging) cancelLongPress();
	}, [isDragging, cancelLongPress]);

	return (
		<div
			ref={setNodeRef}
			data-tab-id={session.sessionId}
			data-shift-key={session.sessionId}
			className="min-w-24 max-w-52 flex-1"
			style={{
				transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
				transition: transition || undefined,
			}}
		>
			<TabPill
				session={session}
				isActive={isActive}
				hidden={isDragging}
				contextOpen={contextOpen}
				onRemove={onRemove ? () => onRemove(member) : undefined}
				buttonProps={{
					...attributes,
					...listeners,

					onContextMenu: (e) => {
						e.preventDefault();
						onContextMenu(session.sessionId, anchorOfElement(e.currentTarget));
					},
					onClick: () => void openSession(session),
					onPointerDown: (e) => {
						listeners?.onPointerDown?.(e);
						longPressDown(e);
					},
					onPointerMove: (e) => {
						listeners?.onPointerMove?.(e);
						longPressMove(e);
					},
					onPointerUp: (e) => {
						listeners?.onPointerUp?.(e);
						longPressUp();
					},
					onPointerCancel: (e) => {
						listeners?.onPointerCancel?.(e);
						longPressCancel();
					},
				}}
			/>
		</div>
	);
}

export function SessionTabBar() {
	const t = useT();
	const platform = getPi().platform;
	const sessions = useSessionsStore((s) => s.sessions);
	const activeSessionId = useSessionsStore((s) => s.activeSessionId);

	const cwd = useSessionsStore((s) => s.cwd);

	const sidePaneOpen = useSidePaneStore(isDockExpanded);

	const toggleSidePane = () => {
		const pane = useSidePaneStore.getState();
		if (!isDockExpanded(pane)) {
			const floating = sidePaneFloatsWhenOpen(window.innerWidth);
			pane.setFloating(floating);

			const sidebar = useUiPreferencesStore.getState();
			if (floating && sidebar.sidebarFloating && !selectSidebarHidden(sidebar)) {
				useUiPreferencesStore.getState().toggleSidebarCollapsed();
			}
		}
		pane.toggleExpanded();
	};

	const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
	useEffect(() => {
		const onResize = () => setViewportWidth(window.innerWidth);
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	const ownerTabs = useSidePaneStore(selectOwnerTabs);
	const activeTabId = useSidePaneStore(selectActiveTabId);
	const sidePaneWidthPx = useSidePaneStore((s) => s.widthPx);
	const sidePaneResizing = useSidePaneStore((s) => s.resizing);
	const visibleSidePaneTabs = ownerTabs.filter((tab) => isTabVisibleInSession(tab, activeSessionId));
	const sidebarCollapsed = useUiPreferencesStore(selectSidebarHidden);
	const toggleSidebarCollapsed = useUiPreferencesStore((s) => s.toggleSidebarCollapsed);
	const [activeId, setActiveId] = useState<string | null>(null);

	const attachScroller = useCallback((el: HTMLDivElement | null) => {
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			const scrollable = el.scrollWidth > el.clientWidth;
			if (!scrollable) return;
			const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
			if (dx === 0) return;
			e.preventDefault();
			el.scrollLeft += dx;
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, []);

	const pinnedSessions = useUiPreferencesStore((s) => s.pinnedSessions);

	const barSessionsVisible = useUiPreferencesStore((s) => s.barSessionsVisible);

	const workspaceMembers = useSessionWorkspaceStore((s) => s.members);
	const removeFromWorkspace = useWorkspaceRemoval();
	const moveWorkspaceMember = useSessionWorkspaceStore((s) => s.moveMember);

	const stripShiftRef = useListShift({ skip: activeId !== null });

	const allSessions = useProjectsStore((s) => s.allSessions);

	const [menu, setMenu] = useState<AnchorState | null>(null);

	const [renaming, setRenaming] = useState<AnchorState | null>(null);

	const activeSessionMeta = barSessionsVisible
		? null
		: resolveActiveSessionMeta(activeSessionId, sessions, allSessions);
	const barSessions = barSessionsVisible
		? resolveWorkspaceSessions(workspaceMembers, sessions, allSessions)
		: activeSessionMeta
			? [activeSessionMeta]
			: [];

	const memberOf = (session: SessionMeta): WorkspaceMember =>
		workspaceMembers.find((m) => m.sessionId === session.sessionId) ?? {
			file: session.sessionFile ?? "",
			sessionId: session.sessionId,
		};
	const closeMenu = useCallback(() => setMenu(null), []);

	const openMenu = (sessionId: string, anchor: MenuAnchor) => {
		if (!canOpenSessionMenu(barSessions.find((s) => s.sessionId === sessionId))) return;
		setRenaming(null);
		setMenu({ sessionId, anchor });
	};

	const contextMenuItems = (sessionId: string): ContextMenuItem[] =>
		sessionMenuItems(t, {
			sessionId,
			pinned: pinnedSessions.includes(sessionId),
			onRename: () => setRenaming(menu),
		});

	const [dragWidth, setDragWidth] = useState<number | null>(null);

	const activeSession = barSessions.find((s) => s.sessionId === activeId);

	const dragging = activeId !== null;

	const sensors = useSensors(
		useSensor(HoldToDragSensor),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);
	const endDrag = () => {
		setActiveId(null);
		setDragWidth(null);
		setDraggingCursor(false);
	};

	const handleRemove = removeFromWorkspace;

	useEffect(() => {
		if (activeSessionId) {
			useTranscriptStore.getState().markCompletionSeen(activeSessionId);
		}
	}, [activeSessionId]);

	const isDesktop = typeof window.pi !== "undefined";
	const chromePadding = isDesktop
		? platform === "darwin"
			? "pl-20 pr-3"
			: platform === "win32"
				? "pl-3 pr-[140px]"
				: "pl-3 pr-3"
		: "px-3";

	const winControlsReserve = isDesktop && platform === "win32";

	const sidePaneRegionWidth = Math.min(
		winControlsReserve ? Math.max(120, sidePaneWidthPx - 140) : sidePaneWidthPx,
		Math.max(SIDE_PANE_REGION_MIN_PX, viewportWidth - TOPBAR_LEFT_RESERVE_PX),
	);

	return (
		<div
			className={`${dragging ? "" : "drag-region"} group relative flex h-12 shrink-0 items-center gap-1 bg-canvas ${chromePadding}`}
		>
			<button
				type="button"
				data-sidebar-toggle=""
				className={`no-drag shrink-0 rounded-lg p-1.5 transition-colors ${
					sidebarCollapsed ? "text-ink-dim hover:bg-hover hover:text-ink" : "bg-hover text-ink"
				}`}
				onClick={toggleSidebarCollapsed}
				aria-label={sidebarCollapsed ? t("sidebar.expand") : t("sidebar.collapse")}
			>
				<PanelLeftIcon size={16} />
			</button>

			<div
				ref={(el) => {
					stripShiftRef.current = el;
					attachScroller(el);
				}}
				className={`flex min-w-0 flex-1 items-center gap-1 overflow-x-scroll ${
					sidePaneOpen ? "" : "mr-[42px]"
				}`}
			>
				<DndContext
					sensors={sensors}
					collisionDetection={closestCenter}
					onDragStart={({ active }) => {
						setActiveId(String(active.id));
						setDragWidth(
							document
								.querySelector(`[data-tab-id="${CSS.escape(String(active.id))}"]`)
								?.getBoundingClientRect().width ?? null,
						);
						setDraggingCursor(true);
					}}
					onDragEnd={({ active, over }: DragEndEvent) => {
						endDrag();
						if (over && active.id !== over.id) {
							moveWorkspaceMember(String(active.id), String(over.id));
						}
					}}
					onDragCancel={endDrag}
				>
					<SortableContext
						items={barSessions.map((s) => s.sessionId)}
						strategy={horizontalListSortingStrategy}
					>
						{barSessions.map((session) => (
							<SessionTab
								key={session.sessionId}
								session={session}
								member={memberOf(session)}
								isActive={session.sessionId === activeSessionId}
								contextOpen={
									menu?.sessionId === session.sessionId || renaming?.sessionId === session.sessionId
								}
								onContextMenu={(sessionId, anchor) => openMenu(sessionId, anchor)}
								onRemove={barSessionsVisible ? handleRemove : undefined}
								sortable={barSessionsVisible}
							/>
						))}
					</SortableContext>

					<DragOverlay
						modifiers={DRAG_MODIFIERS}
						dropAnimation={prefersReducedMotion() ? null : DROP_ANIMATION}
					>
						{activeSession ? (
							<TabPill
								session={activeSession}
								isActive={activeSession.sessionId === activeSessionId}
								ghost
								ghostWidth={dragWidth}
							/>
						) : null}
					</DragOverlay>
				</DndContext>
			</div>

			<div
				data-resizing={sidePaneResizing ? "true" : "false"}
				className={`sidepane-tab-region drag-region relative flex h-full min-w-0 shrink-0 items-center overflow-hidden ${
					winControlsReserve ? "" : "-mr-3"
				}`}
				style={{ width: sidePaneOpen ? `${sidePaneRegionWidth}px` : "0px" }}
			>
				<div
					className={`relative flex h-full min-w-0 flex-1 items-center pl-2 ${winControlsReserve ? "pr-9" : "pr-[42px]"}`}
					style={{ width: `${sidePaneRegionWidth}px` }}
				>
					<SidePaneTabStrip
						tabs={visibleSidePaneTabs}
						activeTabId={activeTabId}
						cwd={cwd ?? ""}
						sessionId={activeSessionId}
					/>
				</div>
			</div>

			<button
				type="button"
				className={`no-drag absolute top-1/2 -translate-y-1/2 shrink-0 rounded-lg p-1.5 transition-colors disabled:opacity-40 ${
					winControlsReserve ? "right-[140px]" : "right-3"
				} ${sidePaneOpen ? "bg-hover text-ink" : "text-ink-dim hover:bg-hover hover:text-ink"}`}
				onClick={toggleSidePane}
				disabled={!cwd}
				aria-label={t("sidepane.toggle")}
				aria-pressed={sidePaneOpen}
			>
				<PanelRightIcon size={16} />
			</button>
			{menu !== null && (
				<ContextMenu anchor={menu.anchor} items={contextMenuItems(menu.sessionId)} onClose={closeMenu} />
			)}
			{renaming !== null && (
				<RenamePopover
					anchor={renaming.anchor}
					value={barSessions.find((s) => s.sessionId === renaming.sessionId)?.name ?? ""}
					onCommit={(name) => {
						setRenaming(null);
						renameSession(renaming.sessionId, name);
					}}
					onCancel={() => setRenaming(null)}
				/>
			)}
		</div>
	);
}
