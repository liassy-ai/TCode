export interface MenuAnchor {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface MenuSize {
	width: number;
	height: number;
}

export interface ViewportSize {
	width: number;
	height: number;
}

interface PlaceOptions {
	gap?: number;

	margin?: number;

	align?: "start" | "end";
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), Math.max(min, max));
}

export function anchorOfElement(el: Element): MenuAnchor {
	const rect = el.getBoundingClientRect();
	return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

export function placeMenu(
	anchor: MenuAnchor,
	size: MenuSize,
	viewport: ViewportSize,
	{ gap = 4, margin = 6, align = "start" }: PlaceOptions = {},
): { x: number; y: number } {
	const below = anchor.top + anchor.height + gap;
	const above = anchor.top - gap - size.height;
	const y = below + size.height > viewport.height - margin && above >= margin ? above : below;

	const endAligned = anchor.left + anchor.width - size.width;
	const leftAligned = anchor.left;
	const flipped = align === "end" || leftAligned + size.width > viewport.width - margin;
	const x = flipped ? endAligned : leftAligned;
	return {
		x: clamp(x, margin, viewport.width - size.width - margin),
		y: clamp(y, margin, viewport.height - size.height - margin),
	};
}
