import { PointerSensor } from "@dnd-kit/core";

const DRAG_HOLD_MS = 400;

const MOUSE_DISTANCE_PX = 5;

const pressInfo = new Map<number, { at: number; x: number; y: number }>();

const touchInfo = new Map<number, { at: number; holdDrag: boolean }>();

if (typeof window !== "undefined") {
	window.addEventListener(
		"pointerdown",
		(event) => {
			if (event.button !== 0) return;
			pressInfo.set(event.pointerId, { at: event.timeStamp, x: event.clientX, y: event.clientY });
		},
		true,
	);
	const forget = (event: PointerEvent) => {
		pressInfo.delete(event.pointerId);
	};
	window.addEventListener("pointerup", forget, true);
	window.addEventListener("pointercancel", forget, true);

	window.addEventListener(
		"touchstart",
		(event) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			const holdDrag = target.closest("[data-hold-drag]") !== null;
			for (const touch of Array.from(event.changedTouches)) {
				touchInfo.set(touch.identifier, { at: event.timeStamp, holdDrag });
			}
		},
		true,
	);

	window.addEventListener(
		"touchmove",
		(event) => {
			for (const touch of Array.from(event.changedTouches)) {
				const info = touchInfo.get(touch.identifier);
				if (info?.holdDrag && event.timeStamp - info.at >= DRAG_HOLD_MS) event.preventDefault();
			}
		},
		{ capture: true, passive: false },
	);
	const forgetTouch = (event: TouchEvent) => {
		for (const touch of Array.from(event.changedTouches)) touchInfo.delete(touch.identifier);
	};
	window.addEventListener("touchend", forgetTouch, true);
	window.addEventListener("touchcancel", forgetTouch, true);
}

export class HoldToDragSensor extends PointerSensor {
	static override activators = [
		{
			eventName: "onPointerMove",
			handler: (event: { nativeEvent: PointerEvent }) => {
				const native = event.nativeEvent;
				if (!native.isPrimary) return false;
				const press = pressInfo.get(native.pointerId);
				if (!press) return false;
				if (native.pointerType === "touch") return native.timeStamp - press.at >= DRAG_HOLD_MS;

				if ((native.buttons & 1) === 0) return false;
				return Math.hypot(native.clientX - press.x, native.clientY - press.y) >= MOUSE_DISTANCE_PX;
			},
		},
	] as unknown as (typeof PointerSensor)["activators"];
}
