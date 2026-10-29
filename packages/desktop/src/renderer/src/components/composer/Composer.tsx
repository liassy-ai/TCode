import type { ImageInput } from "@tcode/shared";
import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useRef, useState } from "react";
import { getPi } from "../../api";
import { useActiveModelInfo, useSessionReadOnly } from "../../hooks/use-session-state";
import { useT } from "../../i18n";
import { RegionHost } from "../../plugins/RegionHost";
import { UI_REGIONS } from "../../plugins/slots";
import { parseAnnotationCommand } from "../../sidepane/panels/browserAnnotate";
import { useChatLayoutStore } from "../../stores/chat-layout";
import {
	ANNOTATION_EDIT_EVENT,
	COMPOSER_FOCUS_EVENT,
	type DraftAnnotation,
	EMPTY_DRAFT,
	NEW_SESSION_DRAFT_KEY,
	useDraftStore,
} from "../../stores/drafts";
import { useSessionsStore } from "../../stores/sessions";
import { pushToast } from "../../stores/toasts";
import { selectTranscript, useTranscriptStore } from "../../stores/transcript";
import { ImagePreviewOverlay } from "../chat/ImagePreview";
import { ArrowUpIcon, PencilIcon, PlusIcon, StopIcon } from "../icons";
import { AnnotationBar, AnnotationChip } from "./AnnotationChip";
import { AtMenu } from "./AtMenu";
import { AttachmentChip } from "./AttachmentChip";
import { ContextRing } from "./ContextRing";
import { resolveDroppedFilePaths } from "./drop-files";
import { ImageTray } from "./ImageTray";
import { ModelPicker } from "./ModelPicker";
import { PermissionPicker } from "./PermissionPicker";
import { QueueBar } from "./QueueBar";
import { QuoteChip } from "./QuoteChip";
import { SendErrorBar } from "./SendErrorBar";
import { SlashMenu } from "./SlashMenu";
import { slashPresentation } from "./slash-label";
import { useAtCompletion } from "./use-at-completion";
import { useComposerSend } from "./use-composer-send";
import { footerRestoreSlackPx, useFooterCompact } from "./use-footer-compact";
import { useSlashMenu } from "./use-slash-menu";

const COMPOSER_FOCUS_BLOCKERS =
	"button, a, input, textarea, select, label, [role='menu'], [role='listbox'], [role='dialog'], [contenteditable='true'], [data-composer-overlay]";

export function Composer({ centered = false }: { centered?: boolean }) {
	const t = useT();
	const activeSessionId = useSessionsStore((s) => s.activeSessionId);

	const readOnly = useSessionReadOnly();
	const cwd = useSessionsStore((s) => s.cwd);

	const trustVersion = useSessionsStore((s) => s.trustVersion);
	const transcript = useTranscriptStore((s) => selectTranscript(s, activeSessionId));

	const extensionPrefillSource = transcript.extensionPrefillSource;

	const activeModelInfo = useActiveModelInfo();

	const imagesSupported = activeModelInfo?.imageInput !== false;

	const { rowRef: footerRowRef, stage: footerStage } = useFooterCompact();

	const draftKey = activeSessionId ?? NEW_SESSION_DRAFT_KEY;
	const draft = useDraftStore((s) => s.bySession[draftKey] ?? EMPTY_DRAFT);
	const { text, images, slashCommand, attachments, quotes, annotations } = draft;
	const updateDraft = useDraftStore((s) => s.updateDraft);
	const setText = (updater: string | ((prev: string) => string)) => {
		updateDraft(draftKey, (d) => ({ ...d, text: typeof updater === "function" ? updater(d.text) : updater }));
	};
	const setImages = (updater: ImageInput[] | ((prev: ImageInput[]) => ImageInput[])) => {
		updateDraft(draftKey, (d) => ({
			...d,
			images: typeof updater === "function" ? updater(d.images) : updater,
		}));
	};
	const setSlashCommand = (command: string | null) => {
		updateDraft(draftKey, (d) => ({ ...d, slashCommand: command }));
	};
	const setAttachments = (updater: string[] | ((prev: string[]) => string[])) => {
		updateDraft(draftKey, (d) => ({
			...d,
			attachments: typeof updater === "function" ? updater(d.attachments) : updater,
		}));
	};
	const appendAttachments = useCallback(
		(paths: string[]) => {
			if (paths.length === 0) return;
			updateDraft(draftKey, (d) => ({
				...d,
				attachments: [...new Set([...d.attachments, ...paths])],
			}));
		},
		[draftKey, updateDraft],
	);
	const setQuotes = (updater: string[] | ((prev: string[]) => string[])) => {
		updateDraft(draftKey, (d) => ({
			...d,
			quotes: typeof updater === "function" ? updater(d.quotes) : updater,
		}));
	};
	const setAnnotations = (updater: DraftAnnotation[] | ((prev: DraftAnnotation[]) => DraftAnnotation[])) => {
		updateDraft(draftKey, (d) => ({
			...d,
			annotations: typeof updater === "function" ? updater(d.annotations) : updater,
		}));
	};
	const [previewImage, setPreviewImage] = useState<ImageInput | null>(null);
	const [annotationsOpen, setAnnotationsOpen] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const boxRef = useRef<HTMLDivElement>(null);
	const annotationsRef = useRef<HTMLDivElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const cardRef = useRef<HTMLDivElement>(null);
	const setFloorPx = useChatLayoutStore((s) => s.setFloorPx);

	useEffect(() => {
		if (!annotationsOpen) return;
		const onPointerDown = (event: PointerEvent) => {
			if (annotationsRef.current && !annotationsRef.current.contains(event.target as Node)) {
				setAnnotationsOpen(false);
			}
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setAnnotationsOpen(false);
		};
		window.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [annotationsOpen]);

	useEffect(() => {
		if (annotations.length === 0) setAnnotationsOpen(false);
	}, [annotations.length]);

	useEffect(() => {
		const card = cardRef.current;
		if (!card) return;
		const col = card.closest("[data-chat-col]") ?? boxRef.current;
		if (!col) return;

		const px = (value: string) => {
			const n = Number.parseFloat(value);
			return Number.isFinite(n) ? n : 0;
		};
		const measureChrome = () => {
			let chrome = 0;
			for (let node: Element | null = card.parentElement; node; node = node.parentElement) {
				const cs = getComputedStyle(node);
				chrome += px(cs.paddingLeft) + px(cs.paddingRight);
				if (node === col) break;
			}
			return Math.max(0, chrome);
		};
		const measure = () => {
			card.setAttribute("data-floor-measuring", "");
			card.style.width = "max-content";
			const want = card.getBoundingClientRect().width;

			const footerSlack = footerRestoreSlackPx(card);
			card.style.width = "";
			card.removeAttribute("data-floor-measuring");
			setFloorPx(Math.ceil(want + measureChrome() + footerSlack));
		};
		measure();

		const mo = new MutationObserver(measure);
		mo.observe(card, { childList: true, subtree: true, characterData: true });
		const ro = new ResizeObserver(measure);
		ro.observe(col);
		window.addEventListener("resize", measure);
		return () => {
			mo.disconnect();
			ro.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, [setFloorPx]);

	const followUpQueue = transcript.followUpQueue;

	const compacting = transcript.compacting;

	const hasContent =
		Boolean(text.trim()) ||
		images.length > 0 ||
		Boolean(slashCommand) ||
		attachments.length > 0 ||
		quotes.length > 0 ||
		annotations.length > 0;

	const send = useComposerSend({
		activeSessionId,
		text,
		images,
		attachments,
		quotes,
		annotations,
		slashCommand,
		followUpQueue,
		compacting,
		agentActive: transcript.agentActive,
		imagesSupported,
		setText,
		setImages,
		setAttachments,
		setQuotes,
		setAnnotations,
		setSlashCommand,
	});
	const { sending, error, setError, feedback, showFeedback, ensureSession, runSlashCommand, handleSend } =
		send;
	const focusTextarea = () => textareaRef.current?.focus();

	const handleComposerMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
		const target = event.target;
		if (target instanceof Element && target.closest(COMPOSER_FOCUS_BLOCKERS)) return;
		event.preventDefault();
		textareaRef.current?.focus();
	};
	const isStreaming = transcript.phase === "streaming" || sending;
	const placeholder = readOnly
		? t("composer.placeholderReadOnly")
		: compacting
			? t("composer.placeholderCompacting")
			: isStreaming
				? t("composer.placeholderQueued")
				: t("composer.placeholder");

	const slash = useSlashMenu({
		activeSessionId,
		cwd,
		trustVersion,
		text,
		slashCommand,
		setText,
		setSlashCommand,
		textareaRef,
		ensureSession,
		runSlashCommand,
		handleSend,
		showFeedback,
		setError,
	});

	const selectedSlashCommand = slash.slashCommands.find((command) => command.name === slashCommand);
	const slashLabel = selectedSlashCommand ? slashPresentation(selectedSlashCommand, t).label : slashCommand;

	const at = useAtCompletion({
		cwd,
		text,
		attachments,
		slashOpen: slash.slashOpen,
		setText,
		setAttachments,
		textareaRef,
	});

	useEffect(() => {
		const onFocusRequest = () => textareaRef.current?.focus();
		window.addEventListener(COMPOSER_FOCUS_EVENT, onFocusRequest);
		return () => window.removeEventListener(COMPOSER_FOCUS_EVENT, onFocusRequest);
	}, []);

	useEffect(() => {
		if (readOnly) return;
		const containsFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;
		const onDragOver = (event: DragEvent) => {
			if (!containsFiles(event)) return;
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
		};
		const onDrop = (event: DragEvent) => {
			if (!containsFiles(event) || !event.dataTransfer) return;
			event.preventDefault();
			appendAttachments(resolveDroppedFilePaths(event.dataTransfer.files, getPi().getPathForFile));
		};
		window.addEventListener("dragover", onDragOver);
		window.addEventListener("drop", onDrop);
		return () => {
			window.removeEventListener("dragover", onDragOver);
			window.removeEventListener("drop", onDrop);
		};
	}, [appendAttachments, readOnly]);

	const { setSlashDismissed } = slash;
	const { setAtDismissed } = at;
	useEffect(() => {
		if (!slash.slashOpen && !at.atOpen) return;
		const onPointerDown = (e: PointerEvent) => {
			if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
				setSlashDismissed(true);
				setAtDismissed(true);
			}
		};
		window.addEventListener("pointerdown", onPointerDown);
		return () => window.removeEventListener("pointerdown", onPointerDown);
	}, [slash.slashOpen, at.atOpen, setSlashDismissed, setAtDismissed]);

	const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		if (extensionPrefillSource) useTranscriptStore.getState().clearExtensionPrefill(activeSessionId ?? "");
		slash.setSlashDismissed(false);
		at.setAtDismissed(false);
		setText(e.target.value);
		const cursor = e.target.selectionStart ?? e.target.value.length;
		slash.updateToken(e.target.value, cursor);
		at.updateToken(e.target.value, cursor);
	};

	const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
		const el = e.currentTarget;
		slash.updateToken(el.value, el.selectionStart ?? el.value.length);
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (at.handleKeyDown(e)) return;
		if (slash.handleKeyDown(e)) return;

		if (slashCommand && e.key === "Escape") {
			slash.restoreSlashPill(e);
			return;
		}
		if (text === "" && (e.key === "Backspace" || e.key === "Delete")) {
			if (attachments.length > 0) {
				e.preventDefault();
				at.handleAttachmentRemove(attachments.length - 1);
				return;
			}
			if (slashCommand) {
				slash.restoreSlashPill(e);
				return;
			}
			if (quotes.length > 0) {
				e.preventDefault();
				setQuotes((prev) => prev.slice(0, -1));
				return;
			}
		}
		if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
			e.preventDefault();
			void handleSend();
		}
	};

	const handleFiles = (files: FileList | File[] | null) => {
		if (!files || files.length === 0) return;

		if (!imagesSupported) return;
		for (const file of Array.from(files)) {
			if (!file.type.startsWith("image/")) continue;
			const reader = new FileReader();
			reader.onload = () => {
				const result = reader.result;
				if (typeof result !== "string") return;
				const comma = result.indexOf(",");
				if (comma === -1) return;
				setImages((prev) => [...prev, { data: result.slice(comma + 1), mimeType: file.type }]);
			};
			reader.readAsDataURL(file);
		}
	};

	const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
		const items = e.clipboardData?.items;
		if (!items) return;
		const files: File[] = [];
		for (const item of items) {
			if (item.type.startsWith("image/")) {
				const file = item.getAsFile();
				if (file) files.push(file);
			}
		}
		if (files.length === 0) return;

		if (!imagesSupported) {
			e.preventDefault();

			pushToast("warning", "composer.imageUnsupported");
			return;
		}
		e.preventDefault();
		handleFiles(files);
	};

	return (
		<div ref={boxRef} className={centered ? "w-full max-w-[760px]" : "shrink-0 px-6 pb-3"}>
			<div ref={cardRef} className="relative mx-auto max-w-[760px]">
				{error && <SendErrorBar error={error} onRetry={() => void handleSend()} />}
				{feedback && !error && (
					<p className={`mb-1.5 text-xs ${feedback.tone === "warn" ? "text-amber-500" : "text-ink-dim"}`}>
						{feedback.message}
					</p>
				)}
				{slash.slashOpen && (
					<SlashMenu
						commands={slash.slashCommands}
						query={slash.slashQuery}
						selectedIndex={slash.slashSelected}
						onSelectedIndexChange={slash.setSlashSelected}
						onPick={(command) => void slash.handleSlashPick(command)}
					/>
				)}
				{at.atOpen && (
					<AtMenu
						files={at.atFiltered}
						selectedIndex={at.atSelected}
						onSelectedIndexChange={at.setAtSelected}
						onPick={at.handleAtPick}
					/>
				)}
				{followUpQueue.length > 0 && (
					<QueueBar
						raw={followUpQueue[0] ?? ""}
						onRestore={() => void send.handleRestoreQueue(focusTextarea)}
					/>
				)}

				{extensionPrefillSource && (
					<div className="flex items-center gap-1.5 px-1 text-[11px] text-ink-faint">
						<PencilIcon size={11} />
						{t("interaction.prefillNote", { source: extensionPrefillSource })}
					</div>
				)}
				<ImageTray
					images={images}
					onPreview={setPreviewImage}
					onRemove={(index) => setImages((prev) => prev.filter((_, i) => i !== index))}
				/>
				<div
					onMouseDown={handleComposerMouseDown}
					className="rounded-[20px] border-[0.5px] border-border bg-surface shadow-soft"
				>
					{quotes.length > 0 && (
						<div className="flex flex-wrap items-center gap-1.5 px-3 pt-2">
							{quotes.map((quote) => (
								<QuoteChip
									key={quote}
									quote={quote}
									onRemove={() => setQuotes((prev) => prev.filter((q) => q !== quote))}
								/>
							))}
						</div>
					)}

					{annotations.length > 0 && (
						<div ref={annotationsRef} className="relative px-3 pt-2">
							<AnnotationBar
								count={annotations.length}
								open={annotationsOpen}
								onToggle={() => setAnnotationsOpen((v) => !v)}
								opensAbove
							/>
							{annotationsOpen && (
								<div className="absolute bottom-full left-3 z-30 mb-1.5 flex w-max max-w-[300px] flex-col gap-1.5 rounded-lg border border-border bg-surface p-2">
									{annotations.map((annotation, index) => {
										const meta = parseAnnotationCommand(annotation.command);
										return (
											<AnnotationChip
												key={annotation.id}
												label={t("composer.annotationChip")}
												number={index + 1}
												elementLabel={meta?.elementLabel ?? ""}
												note={meta?.note ?? ""}
												onClick={() => {
													setAnnotationsOpen(false);
													window.dispatchEvent(
														new CustomEvent(ANNOTATION_EDIT_EVENT, { detail: { id: annotation.id } }),
													);
												}}
												onRemove={() => setAnnotations((prev) => prev.filter((a) => a.id !== annotation.id))}
											/>
										);
									})}
								</div>
							)}
						</div>
					)}

					<div className={`px-4 pb-5.5 ${quotes.length > 0 || annotations.length > 0 ? "pt-1.5" : "pt-2"}`}>
						<div
							className={
								slashCommand || attachments.length > 0
									? "flex flex-wrap items-start gap-x-1.5 gap-y-1"
									: undefined
							}
						>
							{slashCommand && (
								<span className="mt-0.5 flex shrink-0 select-none items-center rounded-md bg-surface px-2 py-0.5 font-mono text-[12px] leading-5 text-ink-2 shadow-pop">
									{slashLabel !== slashCommand && <span className="mr-1.5">{slashLabel}</span>}/{slashCommand}
								</span>
							)}
							{attachments.map((path, index) => (
								<AttachmentChip key={path} path={path} onRemove={() => at.handleAttachmentRemove(index)} />
							))}
							<textarea
								ref={textareaRef}
								className={`max-h-[200px] resize-none bg-transparent text-[14px] leading-relaxed outline-none placeholder:text-ink-faint select-text [field-sizing:content] ${
									slashCommand || attachments.length > 0 ? "min-w-[140px] flex-1" : "w-full"
								}`}
								placeholder={slashCommand ? t("slash.argPlaceholder") : placeholder}
								value={text}
								rows={1}
								disabled={readOnly}
								onChange={handleTextChange}
								onKeyDown={handleKeyDown}
								onSelect={handleSelect}
								onPaste={handlePaste}
							/>
						</div>
					</div>
					<div ref={footerRowRef} className="flex items-center gap-2 px-3 pb-2">
						<input
							ref={fileInputRef}
							type="file"
							accept="image/*"
							multiple
							className="hidden"
							onChange={(e) => {
								handleFiles(e.target.files);
								e.target.value = "";
							}}
						/>
						<button
							type="button"
							className="-ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-ink-dim transition-colors hover:bg-hover hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
							aria-label={t("composer.addImage")}
							title={!imagesSupported ? t("composer.imageUnsupported") : undefined}
							disabled={readOnly || !imagesSupported}
							onClick={() => fileInputRef.current?.click()}
						>
							<PlusIcon size={18} />
						</button>
						<div className={readOnly ? "pointer-events-none opacity-40" : undefined}>
							<PermissionPicker compact={footerStage >= 2} />
						</div>
						<div data-footer-spacer="" className="flex-1" />
						<ContextRing />
						<RegionHost region={UI_REGIONS.ComposerFooter} />
						<div className={readOnly ? "pointer-events-none opacity-40" : undefined}>
							<ModelPicker compact={footerStage >= 1} />
						</div>
						{isStreaming && !hasContent ? (
							<button
								type="button"
								className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-on-ink transition-colors hover:bg-ink-2"
								onClick={() => void send.handleStop()}
								aria-label={t("composer.stop")}
							>
								<StopIcon />
							</button>
						) : (
							<button
								type="button"
								className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-on-ink transition-colors hover:bg-ink-2 disabled:opacity-30"
								disabled={readOnly || !hasContent || sending}
								onClick={() => void handleSend()}
								aria-label={t("composer.send")}
							>
								<ArrowUpIcon size={20} />
							</button>
						)}
					</div>
				</div>
			</div>
			{previewImage && <ImagePreviewOverlay image={previewImage} onClose={() => setPreviewImage(null)} />}
		</div>
	);
}
