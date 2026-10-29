import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { closestCenter, DndContext, DragOverlay, useSensor, useSensors } from "@dnd-kit/core";
import { restrictToHorizontalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import type { SidePaneTabSnapshot } from "@tcode/shared";
import { X } from "lucide-react";
import { type ComponentProps, useCallback, useEffect, useRef, useState } from "react";
import { ContextMenu, type ContextMenuItem } from "../components/ui/ContextMenu";
import type { MenuAnchor } from "../components/ui/place-menu";
import { anchorOfElement } from "../components/ui/place-menu";
import { useT } from "../i18n";
import { HoldToDragSensor } from "../lib/hold-drag";
import { SIDEPANE_REGISTRY, SidePaneTabIcon } from "./registry";
import { SidePaneLauncher } from "./SidePaneLauncher";
import { useSidePaneStore } from "./store";

const DRAG_MODIFIERS = [restrictToHorizontalAxis, restrictToParentElement];

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_PX = 8;

export function SidePaneTabStrip({
	tabs,
	activeTabId,
	cwd,
	sessionId,
}: {
	tabs: readonly SidePaneTabSnapshot[];
	activeTabId: string | null;
	cwd: string;
	sessionId: string | null;
}) {
	const t = useT();
	const activateTab = useSidePaneStore((state) => state.activateTab);
	const closeTab = useSidePaneStore((state) => state.closeTab);
	const closeOtherTabs = useSidePaneStore((state) => state.closeOtherTabs);
	const closeAllTabs = useSidePaneStore((state) => state.closeAllTabs);
	const reorderTabs = useSidePaneStore((state) => state.reorderTabs);
	const [dragging, setDragging] = useState<SidePaneTabSnapshot | null>(null);
	const [menu, setMenu] = useState<{ tab: SidePaneTabSnapshot; anchor: MenuAnchor } | null>(null);

	const openTabMenu = (anchorEl: HTMLElement | null, tab: SidePaneTabSnapshot) => {
		if (!anchorEl) return;
		setMenu({ anchor: anchorOfElement(anchorEl), tab });
	};

	const sensors = useSensors(useSensor(HoldToDragSensor));

	const onDragStart = useCallback(
		(event: DragStartEvent) => {
			setMenu(null);
			const id = event.active.id;
			setDragging(tabs.find((tab) => tab.id === id) ?? null);
		},
		[tabs],
	);

	const onDragEnd = (event: DragEndEvent) => {
		setDragging(null);
		const { active, over } = event;
		if (!over || active.id === over.id) return;
		reorderTabs(String(active.id), String(over.id));
	};

	const menuItems = (tab: SidePaneTabSnapshot): ContextMenuItem[] => [
		{ key: "close", label: t("sidepane.tab.close"), onSelect: () => closeTab(tab.id) },
		{ key: "close-others", label: t("sidepane.tab.closeOthers"), onSelect: () => closeOtherTabs(tab.id) },
		{
			key: "close-all",
			label: t("sidepane.tab.closeAll"),
			separatorBefore: true,
			danger: true,
			onSelect: () => closeAllTabs(),
		},
	];

	return (
		<div className="sidepane-tab-strip flex h-full min-w-0 flex-1 items-center gap-1">
			<DndContext
				collisionDetection={closestCenter}
				modifiers={DRAG_MODIFIERS}
				sensors={sensors}
				onDragStart={onDragStart}
				onDragEnd={onDragEnd}
				onDragCancel={() => setDragging(null)}
			>
				<div className="sidepane-tabs flex min-w-0 shrink items-center gap-0.5 overflow-x-auto">
					<SortableContext items={tabs.map((tab) => tab.id)} strategy={horizontalListSortingStrategy}>
						{tabs.map((tab) => (
							<SortableSidePaneTab
								key={tab.id}
								tab={tab}
								active={tab.id === activeTabId}
								onActivate={() => activateTab(tab.id)}
								onLongPress={(anchorEl) => openTabMenu(anchorEl, tab)}
								onClose={() => closeTab(tab.id)}
								onContextMenu={(event) => openTabMenu(event.currentTarget, tab)}
							/>
						))}
					</SortableContext>
				</div>
				<DragOverlay dropAnimation={null} modifiers={DRAG_MODIFIERS}>
					{dragging ? <SidePaneTabFace tab={dragging} active ghost /> : null}
				</DragOverlay>
			</DndContext>

			<SidePaneLauncher mode="menu" cwd={cwd} sessionId={sessionId} />

			{menu && <ContextMenu anchor={menu.anchor} items={menuItems(menu.tab)} onClose={() => setMenu(null)} />}
		</div>
	);
}

function SortableSidePaneTab({
	tab,
	active,
	onActivate,
	onLongPress,
	onClose,
	onContextMenu,
}: {
	tab: SidePaneTabSnapshot;
	active: boolean;
	onActivate: () => void;

	onLongPress: (anchorEl: HTMLButtonElement | null) => void;
	onClose: () => void;
	onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
	const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id: tab.id });
	const timer = useRef<number | null>(null);
	const origin = useRef<{ x: number; y: number } | null>(null);

	const anchor = useRef<HTMLButtonElement | null>(null);

	const cancelLongPress = () => {
		if (timer.current !== null) {
			window.clearTimeout(timer.current);
			timer.current = null;
		}
		origin.current = null;
	};

	useEffect(
		() => () => {
			if (timer.current !== null) window.clearTimeout(timer.current);
		},
		[],
	);

	useEffect(() => {
		if (!isDragging) return;
		if (timer.current !== null) {
			window.clearTimeout(timer.current);
			timer.current = null;
		}
		origin.current = null;
	}, [isDragging]);

	return (
		<div
			ref={setNodeRef}
			className="sidepane-tab-in shrink-0"
			style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
		>
			<SidePaneTabFace
				tab={tab}
				active={active}
				onClose={onClose}
				hidden={isDragging}
				buttonProps={{
					...attributes,
					...listeners,
					onClick: onActivate,
					onContextMenu: (event) => {
						event.preventDefault();
						onContextMenu(event);
					},
					onPointerDown: (event) => {
						listeners?.onPointerDown?.(event);
						cancelLongPress();
						anchor.current = event.currentTarget;
						origin.current = { x: event.clientX, y: event.clientY };
						timer.current = window.setTimeout(() => {
							timer.current = null;
							onLongPress(anchor.current);
						}, LONG_PRESS_MS);
					},
					onPointerMove: (event) => {
						listeners?.onPointerMove?.(event);
						const start = origin.current;
						if (!start || timer.current === null) return;
						if (
							Math.abs(event.clientX - start.x) > LONG_PRESS_MOVE_PX ||
							Math.abs(event.clientY - start.y) > LONG_PRESS_MOVE_PX
						) {
							cancelLongPress();
						}
					},
					onPointerUp: (event) => {
						listeners?.onPointerUp?.(event);
						cancelLongPress();
					},
					onPointerCancel: (event) => {
						listeners?.onPointerCancel?.(event);
						cancelLongPress();
					},
				}}
			/>
		</div>
	);
}

function SidePaneTabFace({
	tab,
	active,
	ghost,
	hidden,
	onClose,
	buttonProps,
}: {
	tab: SidePaneTabSnapshot;
	active: boolean;

	ghost?: boolean;

	hidden?: boolean;
	onClose?: () => void;
	buttonProps?: ComponentProps<"button">;
}) {
	const t = useT();
	const label = tab.title || t(SIDEPANE_REGISTRY[tab.kind].labelKey);
	return (
		<button
			type="button"
			{...buttonProps}
			data-hold-drag=""
			aria-current={active ? "true" : undefined}
			tabIndex={ghost ? -1 : undefined}
			style={{ touchAction: "pan-x", ...(hidden ? { opacity: 0 } : null) }}
			className={`no-drag group/tab relative flex max-w-40 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[12px] transition-colors motion-reduce:transition-none ${
				active ? "bg-hover text-ink" : "text-ink-dim hover:bg-hover hover:text-ink"
			}`}
			onClick={ghost ? undefined : buttonProps?.onClick}
		>
			<SidePaneTabIcon kind={tab.kind} size={13} />
			<span className="relative min-w-0 flex-1">
				<span className="block truncate pr-4 text-left">{label}</span>
				{onClose && !ghost && (
					<span
						aria-hidden="true"
						title={t("sidepane.tab.close")}
						onClick={(event) => {
							event.stopPropagation();
							onClose();
						}}
						className="invisible absolute right-0 top-1/2 -translate-y-1/2 rounded bg-surface p-0.5 text-ink-dim opacity-0 transition-opacity group-hover/tab:visible group-hover/tab:opacity-100 hover:text-ink motion-reduce:transition-none"
					>
						<X size={11} />
					</span>
				)}
			</span>
		</button>
	);
}
