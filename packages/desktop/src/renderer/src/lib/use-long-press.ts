import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef } from "react";

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_PX = 8;

export function useLongPress(onLongPress: (point: { x: number; y: number }, el: HTMLElement | null) => void) {
	const timer = useRef<number | null>(null);
	const origin = useRef<{ x: number; y: number } | null>(null);
	const pressed = useRef<HTMLElement | null>(null);

	const cancel = useCallback(() => {
		if (timer.current !== null) {
			window.clearTimeout(timer.current);
			timer.current = null;
		}
		origin.current = null;
		pressed.current = null;
	}, []);

	useEffect(() => () => cancel(), [cancel]);

	const swallowNextClick = useCallback(() => {
		const firedAt = performance.now();
		const kill = (event: Event) => {
			if (performance.now() - firedAt > 1000) {
				window.removeEventListener("click", kill, true);
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			window.removeEventListener("click", kill, true);
		};
		window.addEventListener("click", kill, true);
	}, []);

	const onPointerDown = useCallback(
		(event: ReactPointerEvent<HTMLElement>) => {
			if (event.pointerType === "mouse") return;
			cancel();
			pressed.current = event.currentTarget;
			origin.current = { x: event.clientX, y: event.clientY };
			timer.current = window.setTimeout(() => {
				timer.current = null;
				const point = origin.current;
				if (!point) return;
				swallowNextClick();
				onLongPress(point, pressed.current);
			}, LONG_PRESS_MS);
		},
		[cancel, onLongPress, swallowNextClick],
	);

	const onPointerMove = useCallback(
		(event: ReactPointerEvent<HTMLElement>) => {
			const start = origin.current;
			if (!start || timer.current === null) return;
			if (
				Math.abs(event.clientX - start.x) > LONG_PRESS_MOVE_PX ||
				Math.abs(event.clientY - start.y) > LONG_PRESS_MOVE_PX
			) {
				cancel();
			}
		},
		[cancel],
	);

	return { onPointerDown, onPointerMove, onPointerUp: cancel, onPointerCancel: cancel, cancel };
}
