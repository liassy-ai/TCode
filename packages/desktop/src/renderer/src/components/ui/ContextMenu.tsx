import { Fragment, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type MenuAnchor, placeMenu } from "./place-menu";

export interface ContextMenuItem {
	key: string;
	label: string;

	icon?: ReactNode;

	danger?: boolean;

	separatorBefore?: boolean;
	onSelect: () => void;
}

export function ContextMenu({
	anchor,
	items,
	onClose,
	ignorePointerDown,
}: {
	anchor: MenuAnchor;
	items: ContextMenuItem[];
	onClose: () => void;

	ignorePointerDown?: HTMLElement | null;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const { width, height } = el.getBoundingClientRect();
		setPos(placeMenu(anchor, { width, height }, { width: window.innerWidth, height: window.innerHeight }));
	}, [anchor]);

	useEffect(() => {
		const onPointerDown = (e: PointerEvent) => {
			if (ref.current?.contains(e.target as Node)) return;
			if (ignorePointerDown?.contains(e.target as Node)) return;
			onClose();
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};

		window.addEventListener("pointerdown", onPointerDown, true);
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("resize", onClose);
		window.addEventListener("scroll", onClose, true);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown, true);
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("resize", onClose);
			window.removeEventListener("scroll", onClose, true);
		};
	}, [onClose, ignorePointerDown]);

	const renderRow = (item: ContextMenuItem) => (
		<Fragment key={item.key}>
			{item.separatorBefore && <div className="mx-1.5 my-1 h-px bg-border" />}
			<button
				type="button"
				role="menuitem"
				className={`group/item flex h-[30px] w-full items-center gap-[10px] rounded-[7px] px-2 text-left text-[13px] transition-colors hover:bg-hover ${
					item.danger ? "text-red-600" : "text-ink-2 hover:text-ink"
				}`}
				onClick={() => {
					item.onSelect();
					onClose();
				}}
			>
				{item.icon !== undefined && (
					<span
						className={`flex shrink-0 transition-colors ${
							item.danger ? "text-red-600" : "text-ink-dim group-hover/item:text-ink"
						}`}
					>
						{item.icon}
					</span>
				)}
				<span className="truncate">{item.label}</span>
			</button>
		</Fragment>
	);
	return createPortal(
		<div
			ref={ref}
			role="menu"
			className="menu-pop no-drag fixed z-50 w-44 rounded-xl border border-border bg-surface p-1 shadow-pop"
			style={{
				left: pos?.x ?? 0,
				top: pos?.y ?? 0,
				visibility: pos ? "visible" : "hidden",
			}}
		>
			{items.map(renderRow)}
		</div>,
		document.body,
	);
}
