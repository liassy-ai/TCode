import { type RefObject, useLayoutEffect, useRef } from "react";

const SHIFT_EASE = "cubic-bezier(0.2, 0, 0, 1)";
const SHIFT_DURATION = 220;

const APPEAR_DURATION = 140;

export function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface ItemBox {
	x: number;
	y: number;
	el: HTMLElement;
}

export function useListShift(opts?: { skip?: boolean }): RefObject<HTMLDivElement | null> {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const prev = useRef(new Map<string, ItemBox>());
	const skip = opts?.skip ?? false;

	useLayoutEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const items = new Map<string, ItemBox>();
		for (const el of container.querySelectorAll<HTMLElement>("[data-shift-key]")) {
			const key = el.dataset.shiftKey;
			if (key) items.set(key, { x: el.offsetLeft, y: el.offsetTop, el });
		}
		const before = prev.current;
		const added = [...items.keys()].filter((key) => !before.has(key));
		const removedKeys = [...before.keys()].filter((key) => !items.has(key));

		const setChanged = before.size > 0 && (added.length > 0 || removedKeys.length > 0);
		if (setChanged && !skip && !prefersReducedMotion()) {
			for (const [key, item] of items) {
				const from = before.get(key);
				if (!from) {
					item.el.animate([{ opacity: 0 }, { opacity: 1 }], {
						duration: APPEAR_DURATION,
						easing: SHIFT_EASE,
					});
					continue;
				}
				const dx = from.x - item.x;
				const dy = from.y - item.y;
				if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
				item.el.animate(
					[{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0px, 0px)" }],
					{ duration: SHIFT_DURATION, easing: SHIFT_EASE },
				);
			}
		}
		prev.current = items;
	});

	return containerRef;
}
