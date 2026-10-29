import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import {
	normalizeThinkingLevel,
	THINKING_BAR_KNOB,
	thinkingLevelKey,
	thinkingLevelPos,
	visibleThinkingLevels,
} from "../../lib/thinking";
import { useSessionsStore } from "../../stores/sessions";

const DRAG_THRESHOLD_PX = 3;

export function ThinkingSlider({ level, thinkingLevels }: { level: string; thinkingLevels?: string[] }) {
	const t = useT();
	const setThinkingLevel = useSessionsStore((s) => s.setThinkingLevel);
	const [pressing, setPressing] = useState(false);
	const [dragging, setDragging] = useState(false);
	const originX = useRef<number | null>(null);

	const [preview, setPreview] = useState<number | null>(null);
	const pendingRef = useRef<number | null>(null);

	const allLevels = useMemo(() => visibleThinkingLevels(thinkingLevels), [thinkingLevels]);
	const count = allLevels.length;

	const matched = allLevels.indexOf(normalizeThinkingLevel(level));
	const storedIndex = matched >= 0 ? matched : Math.max(count - 1, 0);
	const index = preview ?? storedIndex;
	const activeLevel = allLevels[index] ?? level;

	useEffect(() => {
		if (matched >= 0 || allLevels.length === 0) return;
		const fallback = allLevels[allLevels.length - 1];
		if (fallback && fallback !== level) void setThinkingLevel(fallback);
	}, [matched, level, allLevels, setThinkingLevel]);

	useEffect(() => {
		setPreview(null);
		pendingRef.current = null;
	}, [level]);
	const pos = (i: number) =>
		`calc((100% - ${THINKING_BAR_KNOB}px) * ${thinkingLevelPos(i, count)} + ${THINKING_BAR_KNOB / 2}px)`;

	const fillWidth = index === 0 ? "0px" : pos(index);

	const commit = () => {
		const next = pendingRef.current;
		pendingRef.current = null;
		if (next === null) return;
		const value = allLevels[next];
		if (value && value !== level) void setThinkingLevel(value);
	};

	useEffect(() => {
		if (!pressing) return;
		const release = () => {
			setPressing(false);
			setDragging(false);
			originX.current = null;
			commit();
		};
		window.addEventListener("pointerup", release);
		window.addEventListener("pointercancel", release);
		return () => {
			window.removeEventListener("pointerup", release);
			window.removeEventListener("pointercancel", release);
		};
	}, [pressing]);

	return (
		<div className="flex flex-col gap-[7px] px-2 pt-1 pb-2">
			<div className="flex items-baseline justify-between px-0.5">
				<span className="text-[11px] text-ink-faint">{t("composer.thinkingDepth")}</span>
				<span className="text-[13px] font-medium text-ink-2">{t(thinkingLevelKey(activeLevel))}</span>
			</div>
			<div className="think-slider" data-dragging={dragging ? "true" : "false"}>
				<div className="think-track" />
				<div className="think-fill" style={{ "--fillw": fillWidth } as CSSProperties} />
				{allLevels.map((item, i) => (
					<span
						key={item}
						className="think-tick"
						data-passed={i <= index ? "true" : "false"}
						style={{ left: pos(i) }}
					/>
				))}
				<input
					type="range"
					className="think-range"
					min={0}
					max={Math.max(count - 1, 0)}
					step={1}
					value={index}
					aria-label={t("composer.thinkingDepth")}
					aria-valuetext={t(thinkingLevelKey(activeLevel))}
					onPointerDown={(e) => {
						setPressing(true);
						originX.current = e.clientX;
					}}
					onPointerMove={(e) => {
						if (originX.current === null || dragging) return;
						if (Math.abs(e.clientX - originX.current) > DRAG_THRESHOLD_PX) setDragging(true);
					}}
					onChange={(e) => {
						const next = Number(e.target.value);
						setPreview(next);
						pendingRef.current = next;
					}}
					onPointerUp={commit}
					onKeyUp={commit}
					onBlur={commit}
				/>

				<div className="think-knob-rail" style={{ "--pos": thinkingLevelPos(index, count) } as CSSProperties}>
					<div className="think-knob" />
				</div>
			</div>
		</div>
	);
}
