import { formatSkillCommand, skillDisplayName } from "@tcode/shared";
import { useEffect, useRef, useState } from "react";
import { useSessionBusy, useSessionReadOnly } from "../../hooks/use-session-state";
import { useT } from "../../i18n";
import { copyText } from "../../lib/clipboard";
import { useLongPress } from "../../lib/use-long-press";
import { splitAnnotationMessage } from "../../sidepane/panels/browserAnnotate";
import { useSessionsStore } from "../../stores/sessions";
import type { UIMessage } from "../../stores/transcript";
import { AnnotationBar, AnnotationChip } from "../composer/AnnotationChip";
import { CopyActionIcon, TextSelectIcon, UndoIcon } from "../icons";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { anchorOfElement, type MenuAnchor } from "../ui/place-menu";
import { ImagePreviewOverlay, imageSrc } from "./ImagePreview";
import { CopyButton, RecallButton } from "./message-actions";

export function UserMessage({
	message,
	sessionId = null,
}: {
	message: Extract<UIMessage, { kind: "user" }>;

	sessionId?: string | null;
}) {
	const t = useT();
	const [previewIndex, setPreviewIndex] = useState<number | null>(null);
	const [annotationsOpen, setAnnotationsOpen] = useState(false);
	const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);

	const bubbleRef = useRef<HTMLDivElement>(null);

	const [selectMode, setSelectMode] = useState(false);
	const sessionBusy = useSessionBusy(sessionId);
	const recallMessage = useSessionsStore((s) => s.recallMessage);

	const readOnly = useSessionReadOnly(sessionId);

	const longPress = useLongPress((point) => {
		const el = bubbleRef.current;

		setMenuAnchor(el ? anchorOfElement(el) : { left: point.x, top: point.y, width: 0, height: 0 });
	});

	const holdHandlers = selectMode
		? {}
		: {
				onPointerDown: longPress.onPointerDown,
				onPointerMove: longPress.onPointerMove,
				onPointerUp: longPress.onPointerUp,
				onPointerCancel: longPress.onPointerCancel,
			};

	useEffect(() => {
		if (!selectMode) return;
		const onPointerDown = (event: PointerEvent) => {
			if (bubbleRef.current?.contains(event.target as Node)) return;
			setSelectMode(false);
		};
		window.addEventListener("pointerdown", onPointerDown, true);
		return () => window.removeEventListener("pointerdown", onPointerDown, true);
	}, [selectMode]);

	const segments = message.text ? splitAnnotationMessage(message.text) : [];
	const cardSegments = segments.filter((segment) => segment.kind === "card");
	const textSegments = segments.filter((segment) => segment.kind === "text");

	return (
		<div className={`group flex justify-end${selectMode ? "" : " touch-hold-menu"}`} {...holdHandlers}>
			<div ref={bubbleRef} className="max-w-[85%]">
				{cardSegments.length > 0 && (
					<div className="relative mb-1.5 flex flex-col items-end">
						<AnnotationBar
							count={cardSegments.length}
							open={annotationsOpen}
							onToggle={() => setAnnotationsOpen((v) => !v)}
							opensAbove={false}
						/>
						{annotationsOpen && (
							<div className="absolute right-0 top-full z-30 mt-1.5 flex w-max max-w-[300px] flex-col gap-1.5 rounded-lg border border-border bg-surface p-2">
								{cardSegments.map((segment, index) => (
									<AnnotationChip
										key={index}
										label={t("composer.annotationChip")}
										elementLabel={segment.elementLabel}
										note={segment.note}
									/>
								))}
							</div>
						)}
					</div>
				)}
				{message.images.length > 0 && (
					<div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
						{message.images.map((image, index) => (
							<button
								key={index}
								type="button"
								className="h-16 w-16 overflow-hidden rounded-lg border border-border"
								onClick={() => setPreviewIndex(index)}
							>
								<img
									src={imageSrc(image)}
									alt={`${t("composer.previewImage")} ${index + 1}`}
									className="h-full w-full object-cover"
								/>
							</button>
						))}
					</div>
				)}
				{cardSegments.length > 0 ? (
					<>
						{textSegments.length > 0 && (
							<div className="flex flex-col items-end gap-1.5">
								{textSegments.map((segment, index) => (
									<div
										key={index}
										className="rounded-2xl rounded-br-md bg-bubble px-4 py-2.5 text-[15px] leading-[1.7] whitespace-pre-wrap break-words text-ink select-text"
									>
										{segment.text}
									</div>
								))}
							</div>
						)}
					</>
				) : message.skill ? (
					<div className="rounded-2xl rounded-br-md bg-bubble px-4 py-2.5 text-[15px] leading-[1.7] text-ink select-text">
						<div
							className={
								message.text
									? "mb-1 font-mono text-[12px] text-ink-dim"
									: "font-mono text-[12px] text-ink-dim"
							}
						>
							{t("message.skillInvocation", { name: skillDisplayName(message.skill.name) })}
						</div>
						{message.text && <div className="whitespace-pre-wrap break-words">{message.text}</div>}
					</div>
				) : (
					message.text && (
						<div className="rounded-2xl rounded-br-md bg-bubble px-4 py-2.5 text-[15px] leading-[1.7] whitespace-pre-wrap break-words text-ink select-text">
							{message.text}
						</div>
					)
				)}

				{(message.skill || message.text || message.images.length > 0) && (
					<div className="pointer-coarse:hidden mt-1 flex items-center justify-end gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
						{(message.skill || message.text) && (
							<CopyButton text={message.skill ? formatSkillCommand(message.skill) : message.text} />
						)}
						<RecallButton
							entryId={message.entryId}
							matchText={message.sourceText ?? message.text}
							timestamp={message.timestamp}
							sessionId={sessionId}
						/>
					</div>
				)}
			</div>

			{menuAnchor && (
				<ContextMenu
					anchor={menuAnchor}
					onClose={() => setMenuAnchor(null)}
					items={[
						...(message.skill || message.text
							? [
									{
										key: "select",
										label: t("message.select"),
										icon: <TextSelectIcon size={13} />,
										onSelect: () => setSelectMode(true),
									} satisfies ContextMenuItem,
									{
										key: "copy",
										label: t("message.copy"),
										icon: <CopyActionIcon size={13} />,
										onSelect: () =>
											void copyText(message.skill ? formatSkillCommand(message.skill) : message.text),
									} satisfies ContextMenuItem,
								]
							: []),
						...(readOnly
							? []
							: [
									{
										key: "recall",
										label: t("message.recall"),
										icon: <UndoIcon size={13} />,
										onSelect: () => {
											if (sessionBusy) return;
											void recallMessage(
												{
													entryId: message.entryId,
													text: (message.sourceText ?? message.text) || undefined,
													timestamp: message.timestamp,
												},
												menuAnchor ?? undefined,
											);
										},
									} satisfies ContextMenuItem,
								]),
					]}
				/>
			)}
			{previewIndex !== null && (
				<ImagePreviewOverlay
					images={message.images}
					initialIndex={previewIndex}
					onClose={() => setPreviewIndex(null)}
				/>
			)}
		</div>
	);
}
