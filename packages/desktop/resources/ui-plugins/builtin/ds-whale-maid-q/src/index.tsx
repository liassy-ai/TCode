import { useLanguage, useSessionsStore, useTranscriptStore } from "@tcode/plugin-api";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import blinkUrl from "./assets/blink.png";
import happyUrl from "./assets/happy.png";
import idleUrl from "./assets/idle.png";
import squashUrl from "./assets/squash.png";
import working01Url from "./assets/working01.png";
import working02Url from "./assets/working02.png";


const PET_W = 178;
const PET_H = 300;

type Frame = "idle" | "blink" | "working01" | "working02" | "squash" | "happy";
const FRAME_URLS: Record<Frame, string> = {
	idle: idleUrl,
	blink: blinkUrl,
	working01: working01Url,
	working02: working02Url,
	squash: squashUrl,
	happy: happyUrl,
};
const FRAME_ORDER: Frame[] = ["idle", "blink", "working01", "working02", "squash", "happy"];

const WORKING_FRAMES: Frame[] = ["working01", "working02"];

function frameOpacity(f: Frame, active: Frame): number {
	if (f === "idle") return WORKING_FRAMES.includes(active) || active === "happy" ? 0 : 1;
	if (f === "working01") return WORKING_FRAMES.includes(active) ? 1 : 0;
	return active === f ? 1 : 0;
}

const petCss = `
@keyframes dsmq-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
.dsmq-float { animation: dsmq-float 3.8s ease-in-out infinite; will-change: transform; }

@keyframes dsmq-bounce {
	0% { transform: scale(1); }
	35% { transform: scale(1.1); }
	60% { transform: scale(0.96); }
	100% { transform: scale(1); }
}
.dsmq-bounce { animation: dsmq-bounce 0.62s cubic-bezier(0.34, 1.56, 0.64, 1) 1; transform-origin: 50% 100%; }

.dsmq-stage { position: relative; touch-action: none; outline: none; }
.dsmq-stage:focus-visible { filter: drop-shadow(0 0 6px rgba(125, 175, 255, 0.8)); border-radius: 24px; }
.dsmq-frame {
	position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain;
	transition: opacity 160ms ease; pointer-events: none; -webkit-user-drag: none;
}
.dsmq-frame-instant { transition: none; }

.dsmq-bubbles { position: absolute; left: 64%; top: 0%; pointer-events: none; }
.dsmq-bubbles i {
	position: absolute; width: 9px; height: 9px; border-radius: 9999px;
	border: 1.5px solid rgba(125, 175, 255, 0.95); background: rgba(190, 220, 255, 0.35);
	opacity: 0; animation: dsmq-bubble 1.8s ease-in infinite;
}
.dsmq-bubbles i:nth-child(2) { left: 14px; width: 6px; height: 6px; animation-delay: 0.6s; }
.dsmq-bubbles i:nth-child(3) { left: -12px; width: 7px; height: 7px; animation-delay: 1.1s; }
@keyframes dsmq-bubble {
	0% { transform: translateY(8px) scale(0.6); opacity: 0; }
	25% { opacity: 0.95; }
	100% { transform: translateY(-36px) scale(1); opacity: 0; }
}

.dsmq-heart {
	position: absolute; left: 50%; top: 29%; font-size: 22px; line-height: 1;
	pointer-events: none; animation: dsmq-heart 0.9s ease-out 1 forwards;
}
@keyframes dsmq-heart {
	0% { opacity: 0; transform: translate(-50%, 8px) scale(0.5); }
	25% { opacity: 1; }
	100% { opacity: 0; transform: translate(-50%, -32px) scale(1.15); }
}

@media (prefers-reduced-motion: reduce) {
	.dsmq-float, .dsmq-bounce, .dsmq-heart { animation: none; }
	.dsmq-bubbles { display: none; }
	.dsmq-frame { transition: none; }
}`;

interface DragState {
	pointerId: number;
	startX: number;
	startY: number;
	baseX: number;
	baseY: number;
	moved: boolean;
	lastX: number;
}

export const Pet = memo(function Pet() {
	const lang = useLanguage();
	const activeSessionId = useSessionsStore((s) => s.activeSessionId);
	const agentActive = useTranscriptStore((s) =>
		activeSessionId ? (s.bySession[activeSessionId]?.agentActive ?? false) : false,
	);

	const [offset, setOffset] = useState({ x: 0, y: 0 });
	const [dragging, setDragging] = useState(false);
	const [happyTick, setHappyTick] = useState(0);
	const [blinking, setBlinking] = useState(false);
	const [workFlip, setWorkFlip] = useState(false);
	const [jelly, setJelly] = useState({ sx: 1, sy: 1 });

	const stageRef = useRef<HTMLButtonElement | null>(null);
	const dragRef = useRef<DragState | null>(null);
	const offsetRef = useRef(offset);
	offsetRef.current = offset;
	const happyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const clampOffset = useCallback((nx: number, ny: number) => {
		const el = stageRef.current;
		if (!el) return { x: nx, y: ny };
		const cur = offsetRef.current;
		const r = el.getBoundingClientRect();
		const baseL = r.left - cur.x;
		const baseR = r.right - cur.x;
		const baseT = r.top - cur.y;
		const baseB = r.bottom - cur.y;
		const M = 10;
		return {
			x: Math.min(Math.max(nx, M - baseL), window.innerWidth - M - baseR),
			y: Math.min(Math.max(ny, M - baseT), window.innerHeight - M - baseB),
		};
	}, []);

	useEffect(() => {
		if (agentActive || dragging || happyTick > 0) return;
		if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
		let t1: ReturnType<typeof setTimeout> | undefined;
		let t2: ReturnType<typeof setTimeout> | undefined;
		let dead = false;
		const loop = () => {
			t1 = setTimeout(
				() => {
					if (dead) return;
					setBlinking(true);
					t2 = setTimeout(() => {
						setBlinking(false);
						if (!dead) loop();
					}, 150);
				},
				2400 + Math.random() * 2800,
			);
		};
		loop();
		return () => {
			dead = true;
			if (t1) clearTimeout(t1);
			if (t2) clearTimeout(t2);
		};
	}, [agentActive, dragging, happyTick]);

	useEffect(() => {
		if (!agentActive || dragging || happyTick > 0) {
			setWorkFlip(false);
			return;
		}
		if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
		const t = setInterval(() => setWorkFlip((f) => !f), 600);
		return () => clearInterval(t);
	}, [agentActive, dragging, happyTick]);

	useEffect(() => {
		const onResize = () => setOffset((o) => clampOffset(o.x, o.y));
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, [clampOffset]);

	useEffect(
		() => () => {
			if (happyTimer.current) clearTimeout(happyTimer.current);
		},
		[],
	);

	const triggerHappy = () => {
		if (happyTimer.current) clearTimeout(happyTimer.current);
		setHappyTick((n) => n + 1);
		happyTimer.current = setTimeout(() => setHappyTick(0), 900);
	};

	const frame: Frame =
		dragging && dragRef.current?.moved
			? "squash"
			: happyTick > 0
				? "happy"
				: agentActive
					? workFlip
						? "working02"
						: "working01"
					: blinking
						? "blink"
						: "idle";

	return (
		<>
			<style>{petCss}</style>
			<div
				className="pointer-events-auto m-5 select-none"
				style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
			>
				<div className="dsmq-float">
					<div key={happyTick} className={happyTick > 0 ? "dsmq-bounce" : undefined}>
						<button
							ref={stageRef}
							type="button"
							className="dsmq-stage block"
							aria-label={
								lang === "zh"
									? "Q版鲸鱼娘桌宠：拖拽移动位置，点一下她会开心"
									: "Chibi whale maid pet: drag to move, click to make her happy"
							}
							style={{
								width: PET_W,
								height: PET_H,
								transform: `scale(${jelly.sx}, ${jelly.sy})`,
								transformOrigin: "50% 100%",
								transition: dragging ? "none" : "transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1)",
								cursor: dragging ? "grabbing" : "grab",
							}}
							onPointerDown={(e) => {
								if (e.button !== 0) return;
								e.currentTarget.setPointerCapture(e.pointerId);
								dragRef.current = {
									pointerId: e.pointerId,
									startX: e.clientX,
									startY: e.clientY,
									baseX: offsetRef.current.x,
									baseY: offsetRef.current.y,
									moved: false,
									lastX: e.clientX,
								};
							}}
							onPointerMove={(e) => {
								const d = dragRef.current;
								if (!d || e.pointerId !== d.pointerId) return;
								const dx = e.clientX - d.startX;
								const dy = e.clientY - d.startY;
								if (!d.moved) {
									if (Math.hypot(dx, dy) <= 5) return;
									d.moved = true;
									setDragging(true);
								}
								setOffset(clampOffset(d.baseX + dx, d.baseY + dy));
								const vx = e.clientX - d.lastX;
								d.lastX = e.clientX;
								const k = Math.min(Math.abs(vx) * 0.004, 0.07);
								setJelly({ sx: 1 + k, sy: 1 - k * 0.7 });
							}}
							onPointerUp={(e) => {
								const d = dragRef.current;
								if (!d || e.pointerId !== d.pointerId) return;
								dragRef.current = null;
								setJelly({ sx: 1, sy: 1 });
								if (d.moved) setDragging(false);
								else triggerHappy();
							}}
							onPointerCancel={(e) => {
								const d = dragRef.current;
								if (!d || e.pointerId !== d.pointerId) return;
								dragRef.current = null;
								setDragging(false);
								setJelly({ sx: 1, sy: 1 });
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									triggerHappy();
								}
							}}
						>
							{FRAME_ORDER.map((f) => (
								<img
									key={f}
									src={FRAME_URLS[f]}
									alt=""
									draggable={false}
									className={f === "working02" ? "dsmq-frame dsmq-frame-instant" : "dsmq-frame"}
									style={{ opacity: frameOpacity(f, frame) }}
								/>
							))}
							{agentActive && !dragging && (
								<span className="dsmq-bubbles" aria-hidden="true">
									<i />
									<i />
									<i />
								</span>
							)}
							{happyTick > 0 && (
								<span key={happyTick} className="dsmq-heart" aria-hidden="true">
									💙
								</span>
							)}
						</button>
					</div>
				</div>
			</div>
		</>
	);
});
