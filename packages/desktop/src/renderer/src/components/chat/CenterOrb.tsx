import { useEffect, useRef, useState } from "react";
import { useThemeStore } from "../../stores/theme";
import { drawCenterOrb } from "./center-orb-draw";

const BASE = 64;

const ORB_OPACITY = 1;

const RATIO = 0.42;
const MIN_PX = 180;
const MAX_PX = 340;

const FADE_IN_MS = 650;
const FADE_OUT_MS = 300;

export function CenterOrb({ visible }: { visible: boolean }) {
	const wrapRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [px, setPx] = useState(0);
	const [mounted, setMounted] = useState(false);
	const [on, setOn] = useState(false);
	const dark = useThemeStore((s) => s.resolved) === "dark";

	useEffect(() => {
		if (visible) {
			setMounted(true);
			const raf = requestAnimationFrame(() => setOn(true));
			return () => cancelAnimationFrame(raf);
		}
		setOn(false);
		const timer = setTimeout(() => setMounted(false), FADE_OUT_MS);
		return () => clearTimeout(timer);
	}, [visible]);

	useEffect(() => {
		const wrap = wrapRef.current;
		if (!wrap || !mounted) return;
		const measure = () => {
			const { width, height } = wrap.getBoundingClientRect();
			setPx(Math.round(Math.min(MAX_PX, Math.max(MIN_PX, Math.min(width, height) * RATIO))));
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(wrap);
		return () => observer.disconnect();
	}, [mounted]);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || px <= 0 || !mounted) return;
		const dpr = Math.min(2, window.devicePixelRatio || 1);
		canvas.width = Math.round(px * dpr);
		canvas.height = Math.round(px * dpr);
	}, [px, mounted]);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || px <= 0 || !mounted) return;
		const ctx = canvas.getContext("2d");
		if (!ctx || canvas.width === 0) return;
		const k = canvas.width / BASE;
		const paint = (t: number) => {
			ctx.setTransform(k, 0, 0, k, 0, 0);
			ctx.clearRect(0, 0, BASE, BASE);
			drawCenterOrb(ctx, BASE, t, dark);
		};
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			paint(0.6);
			return;
		}
		let raf = 0;
		const tick = () => {
			paint(performance.now() / 1000);
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [dark, px, mounted]);

	if (!mounted) return null;
	return (
		<div
			ref={wrapRef}
			className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
			aria-hidden="true"
		>
			{px > 0 && (
				<div
					className="relative"
					style={{
						width: px,
						height: px,
						opacity: on ? ORB_OPACITY : 0,
						transform: on ? "scale(1)" : "scale(0.94)",
						transitionProperty: "opacity, transform",
						transitionDuration: on ? `${FADE_IN_MS}ms` : `${FADE_OUT_MS}ms`,
						transitionTimingFunction: on ? "ease-out" : "ease-in",
					}}
				>
					<canvas ref={canvasRef} className="absolute inset-0" style={{ width: px, height: px }} />
				</div>
			)}
		</div>
	);
}
