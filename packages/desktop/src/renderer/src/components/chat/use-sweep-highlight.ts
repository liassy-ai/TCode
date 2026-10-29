import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

const BAND_PX = 260;

const SWEEP_SPEED = 160;

function bandGradient(centerRel: number): string {
	const s = centerRel - BAND_PX / 2;
	const stop = (f: number) => `${s + f * BAND_PX}px`;
	return `linear-gradient(90deg, var(--shimmer-highlight) ${stop(0)}, color-mix(in srgb, var(--shimmer-highlight) 75%, currentColor) ${stop(0.28)}, color-mix(in srgb, var(--shimmer-highlight) 30%, currentColor) ${stop(0.46)}, color-mix(in srgb, currentColor 90%, var(--shimmer-highlight)) ${stop(0.5)}, color-mix(in srgb, var(--shimmer-highlight) 30%, currentColor) ${stop(0.54)}, color-mix(in srgb, var(--shimmer-highlight) 75%, currentColor) ${stop(0.72)}, var(--shimmer-highlight) ${stop(1)})`;
}

function clearSweepStyles(els: (HTMLElement | null)[]) {
	for (const el of els) {
		if (!el) continue;
		el.style.backgroundImage = "";
		el.style.backgroundSize = "";
		el.style.backgroundPosition = "";
		el.style.backgroundRepeat = "";
		el.style.backgroundClip = "";
		el.style.removeProperty("-webkit-background-clip");
		el.style.removeProperty("-webkit-text-fill-color");
	}
}

export function useSweepHighlight(
	enabled: boolean,
	targetsKey: string,
): { labelRef: RefObject<HTMLSpanElement | null>; wrapRef: RefObject<HTMLDivElement | null> } {
	const labelRef = useRef<HTMLSpanElement>(null);
	const wrapRef = useRef<HTMLDivElement>(null);

	const paintRef = useRef<() => void>(() => {});

	useEffect(() => {
		if (!enabled) return;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const label = labelRef.current;
		if (!label) return;

		let centerAbs = Number.NaN;
		const paint = () => {
			const nameEls = Array.from(wrapRef.current?.querySelectorAll<HTMLElement>("[data-shimmer-name]") ?? []);
			const targets: HTMLElement[] = [label, ...nameEls];
			const pairs = targets.map((el) => ({ el, rect: el.getBoundingClientRect() }));
			const visible = pairs.filter((p) => p.rect.width > 0);
			if (visible.length === 0) return;
			const left = Math.min(...visible.map((p) => p.rect.left));
			const right = Math.max(...visible.map((p) => p.rect.right));
			if (Number.isNaN(centerAbs)) centerAbs = left - BAND_PX;

			const lo = left - BAND_PX;
			const hi = right + BAND_PX;
			if (centerAbs > hi) {
				centerAbs = lo + ((centerAbs - lo) % (hi - lo));
			}
			for (const { el, rect } of pairs) {
				if (rect.width === 0) continue;
				el.style.backgroundImage = bandGradient(centerAbs - rect.left);
			}
		};
		paintRef.current = paint;
		let raf = 0;
		let last = performance.now();
		const tick = (now: number) => {
			const dt = Math.min(now - last, 100);
			last = now;
			centerAbs += SWEEP_SPEED * (dt / 1000);
			paint();
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => {
			cancelAnimationFrame(raf);
			paintRef.current = () => {};
			clearSweepStyles([
				labelRef.current,
				...Array.from(wrapRef.current?.querySelectorAll<HTMLElement>("[data-shimmer-name]") ?? []),
			]);
		};
	}, [enabled]);

	useLayoutEffect(() => {
		if (enabled) paintRef.current();
	}, [targetsKey, enabled]);

	useLayoutEffect(() => {
		if (!enabled) clearSweepStyles([labelRef.current]);
	}, [enabled]);

	return { labelRef, wrapRef };
}
