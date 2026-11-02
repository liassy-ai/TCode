import { Check } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ElementAnnotation } from "./browserAnnotate";

export interface AnnotationRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface AnnotationMarker {
	id: string;
	number: number;
	pageUrl: string;
	element: ElementAnnotation;
	note: string;

	command: string;
}

const GAP = 6;
const INPUT_WIDTH = 200;
const INPUT_HEIGHT = 36;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function annotationLayout(
	rect: AnnotationRect,
	viewport: { width: number; height: number },
	box: { width: number; height: number },
): { box: AnnotationRect; input: AnnotationRect } {
	const fx = viewport.width > 0 ? box.width / viewport.width : 1;
	const fy = viewport.height > 0 ? box.height / viewport.height : 1;
	const left = rect.left * fx;
	const top = rect.top * fy;
	const width = Math.max(0, rect.width * fx);
	const height = Math.max(0, rect.height * fy);

	const inputWidth = clamp(INPUT_WIDTH, 80, Math.max(80, box.width - 4));
	let inputTop = top + height + GAP;
	if (inputTop + INPUT_HEIGHT > Math.max(0, box.height - 2)) inputTop = top - INPUT_HEIGHT - GAP;
	inputTop = clamp(inputTop, 2, Math.max(2, box.height - INPUT_HEIGHT - 2));
	const inputLeft = clamp(left, 2, Math.max(2, box.width - inputWidth - 2));
	return {
		box: { left, top, width, height },
		input: { left: inputLeft, top: inputTop, width: inputWidth, height: INPUT_HEIGHT },
	};
}

export function AnnotationLayer({
	element,
	box,
	note,
	onNote,
	onInsert,
	placeholder,
	insertLabel,
}: {
	element: ElementAnnotation;

	box: { width: number; height: number };
	note: string;
	onNote: (value: string) => void;
	onInsert: () => void;
	placeholder: string;
	insertLabel: string;
}) {
	const pos = annotationLayout(element.rect, element.viewport, box);
	const hasNote = note.trim().length > 0;
	const checkSize = 22;
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	return (
		<>
			<div
				aria-hidden
				className="pointer-events-none absolute z-10 rounded-[3px] border-[3px] border-blue-600 bg-blue-500/20"
				style={pos.box}
			/>
			<input
				ref={inputRef}
				value={note}
				onChange={(event) => onNote(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						onInsert();
					}
				}}
				placeholder={placeholder}
				spellCheck={false}
				className="absolute z-10 h-9 rounded-full border border-border-strong bg-surface pr-10 pl-3.5 text-[13px] text-ink shadow-pop outline-none placeholder:text-ink-faint"
				style={pos.input}
			/>

			{hasNote && (
				<button
					type="button"
					aria-label={insertLabel}
					title={insertLabel}
					onClick={onInsert}
					className="absolute z-10 flex items-center justify-center rounded-full bg-blue-500 text-white shadow-pop transition-transform hover:scale-110 motion-reduce:transition-none"
					style={{
						left: pos.input.left + pos.input.width - checkSize - 6,
						top: pos.input.top + (pos.input.height - checkSize) / 2,
						width: checkSize,
						height: checkSize,
					}}
				>
					<Check size={13} strokeWidth={3.5} />
				</button>
			)}
		</>
	);
}

const BADGE_SIZE = 18;

export function AnnotationBadge({
	number,
	rect,
	viewport,
	box,
	onClick,
	label,
}: {
	number: number;
	rect: AnnotationRect;
	viewport: { width: number; height: number };
	box: { width: number; height: number };
	onClick?: () => void;
	label?: string;
}) {
	const pos = annotationLayout(rect, viewport, box);
	const left = clamp(pos.box.left + pos.box.width + 4, 2, Math.max(2, box.width - BADGE_SIZE - 2));
	const top = clamp(
		pos.box.top + pos.box.height / 2 - BADGE_SIZE / 2,
		2,
		Math.max(2, box.height - BADGE_SIZE - 2),
	);
	const style = { left, top, width: BADGE_SIZE, height: BADGE_SIZE, fontSize: 11, fontWeight: 700 };
	const base =
		"absolute z-10 flex items-center justify-center rounded-full border-2 border-white bg-blue-500 text-white shadow-pop";
	if (!onClick) {
		return (
			<div aria-hidden className={`${base} pointer-events-none`} style={style}>
				{number}
			</div>
		);
	}
	return (
		<button
			type="button"
			onClick={onClick}
			title={label}
			aria-label={label}
			className={`${base} cursor-pointer transition-transform hover:scale-110 motion-reduce:transition-none`}
			style={style}
		>
			{number}
		</button>
	);
}
