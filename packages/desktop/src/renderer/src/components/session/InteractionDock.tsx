import type { ExtensionDialogQuestion, ExtensionDialogRequest, ExtensionDialogRespond } from "@tcode/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { useTranscriptStore } from "../../stores/transcript";
import { CheckMarkIcon, ClockIcon, FileTextIcon, HelpIcon, PencilIcon } from "../icons";
import { composeAskAnswer } from "./ask-answer";

const EXIT_MS = 150;

function FormFields({
	questions,
	onSubmit,
	onCancel,
}: {
	questions: ExtensionDialogQuestion[];
	onSubmit: (answers: string[]) => void;
	onCancel: () => void;
}) {
	const t = useT();
	const [step, setStep] = useState(0);

	const [picks, setPicks] = useState<string[][]>(() => questions.map(() => []));
	const [customs, setCustoms] = useState<string[]>(() => questions.map(() => ""));
	const [useCustom, setUseCustom] = useState<boolean[]>(() =>
		questions.map((q) => (q.options ?? []).length === 0),
	);
	const [sending, setSending] = useState(false);
	const total = questions.length;
	const index = Math.min(step, Math.max(total - 1, 0));
	const question = questions[index];

	const effective = (at: number) =>
		composeAskAnswer(picks[at] ?? [], useCustom[at] ? (customs[at] ?? "") : "");
	const allAnswered = total > 0 && questions.every((_, at) => effective(at).trim().length > 0);
	if (!question) return null;
	const options = question.options ?? [];
	const multi = question.multiple === true;
	const picked = picks[index] ?? [];
	const answered = effective(index).trim().length > 0;
	const isLast = index >= total - 1;

	const goNext = () => {
		if (!isLast) {
			setStep(index + 1);
			return;
		}
		if (!allAnswered || sending) return;
		setSending(true);
		onSubmit(questions.map((_, at) => effective(at).trim()));
	};

	const pick = (option: string) => {
		if (multi) {
			setPicks((prev) =>
				prev.map((item, at) =>
					at === index
						? item.includes(option)
							? item.filter((chosen) => chosen !== option)
							: [...item, option]
						: item,
				),
			);
			return;
		}
		setPicks((prev) => prev.map((item, at) => (at === index ? [option] : item)));
		setUseCustom((prev) => prev.map((item, at) => (at === index ? false : item)));
		if (!isLast) setStep(index + 1);
	};

	const toggleCustom = () => {
		const next = !useCustom[index];
		setUseCustom((prev) => prev.map((item, at) => (at === index ? next : item)));
		if (!multi && next) setPicks((prev) => prev.map((item, at) => (at === index ? [] : item)));
	};
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-2 px-1">
				<span className="max-h-[30vh] min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words text-[12px] text-ink-faint">
					{question.question}
				</span>
				{multi && (
					<span className="flex-none rounded-full bg-ink/6 px-1.5 py-0.5 text-[10px] text-ink-2">
						{t("dialogs.multiple")}
					</span>
				)}
				{total > 1 && (
					<span className="flex flex-none items-center gap-0.5">
						<button
							type="button"
							aria-label={t("dialogs.prev")}
							disabled={index === 0}
							onClick={() => setStep(index - 1)}
							className="flex h-4 w-4 items-center justify-center rounded-[5px] text-[13px] leading-none text-ink-faint transition-colors hover:bg-hover hover:text-ink-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
						>
							‹
						</button>
						<span className="text-[11px] text-ink-faint tabular-nums">
							{t("dialogs.step", { current: index + 1, total })}
						</span>
						<button
							type="button"
							aria-label={t("dialogs.next")}
							disabled={isLast || !answered}
							onClick={() => setStep(index + 1)}
							className="flex h-4 w-4 items-center justify-center rounded-[5px] text-[13px] leading-none text-ink-faint transition-colors hover:bg-hover hover:text-ink-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
						>
							›
						</button>
					</span>
				)}
			</div>

			<div className="-mx-1.5 max-h-[45vh] overflow-y-auto">
				{options.length > 0 && (
					<div className="flex flex-col gap-y-1.5">
						{options.map((option, i) => (
							<button
								key={option}
								type="button"
								onClick={() => pick(option)}
								className={`group flex items-center gap-2 rounded-[9px] px-3 py-1.5 text-left text-[13px] transition-colors ${
									picked.includes(option) ? "bg-ink/15 text-ink" : "text-ink-2 hover:bg-hover"
								}`}
							>
								<span
									className={`flex h-4 w-[18px] flex-none items-center justify-center rounded-[5px] text-[10px] tabular-nums ${
										picked.includes(option) ? "bg-ink text-on-ink" : "bg-ink/6 text-ink-2"
									}`}
								>
									{picked.includes(option) ? <CheckMarkIcon size={11} /> : i + 1}
								</span>
								<span className="min-w-0 break-words leading-[1.5]">{option}</span>
							</button>
						))}
						{question.allowCustom && (
							<button
								type="button"
								onClick={toggleCustom}
								className={`group flex items-center gap-2 rounded-[9px] px-3 py-1.5 text-left text-[13px] transition-colors ${
									useCustom[index] ? "bg-ink/15 text-ink" : "text-ink-2 hover:bg-hover"
								}`}
							>
								<span
									className={`flex h-4 w-[18px] flex-none items-center justify-center rounded-[5px] text-[10px] tabular-nums ${
										useCustom[index] ? "bg-ink text-on-ink" : "bg-ink/6 text-ink-2"
									}`}
								>
									{useCustom[index] ? <CheckMarkIcon size={11} /> : options.length + 1}
								</span>
								<span className="min-w-0 break-words leading-[1.5]">{t("dialogs.other")}</span>
							</button>
						)}
					</div>
				)}
				{useCustom[index] && (
					<input
						type="text"
						placeholder={question.placeholder ?? ""}
						value={customs[index] ?? ""}
						onChange={(e) =>
							setCustoms((prev) => prev.map((item, at) => (at === index ? e.target.value : item)))
						}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.nativeEvent.isComposing) {
								e.preventDefault();
								goNext();
							}
						}}
						className="mt-1.5 w-full rounded-[9px] bg-hover/60 px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint"
					/>
				)}
			</div>
			<div className="flex items-center gap-1">
				<span className="mr-auto text-[11px] text-ink-faint">
					{multi ? t("interaction.hintFormMultiple") : t("interaction.hintForm")}
				</span>
				<button
					type="button"
					onClick={onCancel}
					className="rounded-[7px] px-2.5 py-1 text-[12px] text-ink-faint transition-colors hover:bg-hover hover:text-ink-2"
				>
					{t("dialogs.cancel")}
				</button>
				{multi && !isLast && (
					<button
						type="button"
						disabled={!answered}
						onClick={() => setStep(index + 1)}
						className="rounded-[7px] px-2.5 py-1 text-[12px] font-medium text-ink transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-transparent"
					>
						{t("dialogs.next")}
					</button>
				)}
				{isLast && (
					<button
						type="button"
						disabled={!allAnswered || sending}
						onClick={goNext}
						className="rounded-[7px] px-2.5 py-1 text-[12px] font-medium text-ink transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-transparent"
					>
						{t("dialogs.submit")}
					</button>
				)}
			</div>
		</div>
	);
}

const KIND_GLYPH = {
	select: HelpIcon,
	input: PencilIcon,
	editor: FileTextIcon,

	confirm: HelpIcon,

	form: HelpIcon,
} as const;

function GhostAction({
	onClick,
	strong,
	children,
}: {
	onClick: () => void;
	strong?: boolean;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`rounded-[7px] px-2.5 py-1 text-[12px] transition-colors hover:bg-hover ${
				strong ? "font-medium text-ink hover:text-ink" : "text-ink-faint hover:text-ink-2"
			}`}
		>
			{children}
		</button>
	);
}

function HeadMeta({ request, queueCount }: { request: ExtensionDialogRequest; queueCount: number }) {
	const t = useT();
	const { timeoutMs, requestedAt } = request;
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (timeoutMs === undefined) return;
		const timer = setInterval(() => setNow(Date.now()), 250);
		return () => clearInterval(timer);
	}, [timeoutMs]);
	const remainingSec =
		timeoutMs === undefined ? null : Math.max(0, Math.ceil((timeoutMs - (now - requestedAt)) / 1000));
	return (
		<>
			{remainingSec !== null && (
				<span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-ink-faint tabular-nums">
					<ClockIcon size={11} />
					{remainingSec}s
				</span>
			)}
			{queueCount > 0 && (
				<span className="shrink-0 text-[11px] text-ink-faint">
					{t("interaction.queueMore", { count: queueCount })}
				</span>
			)}
		</>
	);
}

export function InteractionDock({ sessionId }: { sessionId: string | null }) {
	const t = useT();
	const pending = useTranscriptStore((s) => (sessionId ? s.bySession[sessionId]?.pendingDialogs : undefined));
	const resolveExtensionDialog = useTranscriptStore((s) => s.resolveExtensionDialog);
	const request = pending?.[0] ?? null;
	const queueCount = (pending?.length ?? 1) - 1;

	const [shown, setShown] = useState<ExtensionDialogRequest | null>(null);
	const [leaving, setLeaving] = useState(false);

	const [error, setError] = useState<string | null>(null);
	const [sending, setSending] = useState(false);

	const [highlight, setHighlight] = useState(0);
	const cardRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const editorRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (request) {
			setShown(request);
			setLeaving(false);
			setError(null);
			setHighlight(0);
			return;
		}
		if (!shown) return;
		setLeaving(true);
		const timer = setTimeout(() => {
			setShown(null);
			setLeaving(false);
		}, EXIT_MS);
		return () => clearTimeout(timer);
	}, [request, shown]);

	useEffect(() => {
		if (!shown || leaving) return;
		if (shown.kind === "input") inputRef.current?.focus();
		else if (shown.kind === "editor") editorRef.current?.focus();
		else cardRef.current?.focus();
	}, [shown, leaving]);

	const respond = useCallback(
		async (answer: ExtensionDialogRespond) => {
			if (!shown || leaving || !sessionId || sending) return;
			setSending(true);
			setError(null);
			try {
				await getPi().respondExtensionDialog({ requestId: shown.id, answer });
				resolveExtensionDialog(sessionId, shown.id);
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			} finally {
				setSending(false);
			}
		},
		[shown, leaving, sessionId, sending, resolveExtensionDialog],
	);

	const options = shown?.kind === "select" ? (shown.options ?? []) : [];

	const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
		if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			void respond({ cancelled: true });
			return;
		}
		if (shown?.kind !== "select" || options.length === 0) return;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setHighlight((h) => (h + 1) % options.length);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setHighlight((h) => (h - 1 + options.length) % options.length);
		} else if (e.key === "Enter") {
			e.preventDefault();
			void respond({ value: options[highlight] ?? "" });
		} else if (/^[1-9]$/.test(e.key)) {
			const idx = Number(e.key) - 1;
			if (idx < options.length) {
				e.preventDefault();
				void respond({ value: options[idx] ?? "" });
			}
		}
	};

	if (!shown) return null;

	const hint =
		shown.kind === "select"
			? t("interaction.hintSelect")
			: shown.kind === "input"
				? t("interaction.hintInput")
				: shown.kind === "editor"
					? t("interaction.hintEditor")
					: shown.kind === "form"
						? t("interaction.hintForm")
						: t("interaction.hintConfirm");
	const Glyph = KIND_GLYPH[shown.kind];

	return (
		<div className="relative z-20 shrink-0 px-6 pb-3">
			<div className="mx-auto max-w-[760px]">
				<div
					key={shown.id}
					ref={cardRef}
					tabIndex={-1}
					role="dialog"
					aria-modal
					onKeyDown={onKeyDown}
					className={`dock-in flex flex-col gap-2.5 rounded-[14px] bg-surface px-3.5 pt-3 pb-2.5 shadow-soft outline-none ${
						leaving ? "dock-exit" : ""
					}`}
				>
					{(shown.title || queueCount > 0) && (
						<div className="flex min-h-5 items-center gap-2">
							<span className="flex-none text-ink-faint" aria-hidden="true">
								<Glyph />
							</span>
							<h3 className="min-w-0 flex-1 truncate text-[13px] font-medium tracking-[-0.01em] text-ink-2">
								{shown.title}
							</h3>
							<HeadMeta request={shown} queueCount={queueCount} />
						</div>
					)}

					{shown.kind === "select" && (
						<div className="-mx-1.5 flex flex-col gap-y-0.5 divide-y divide-border/70">
							{options.map((option, i) => (
								<button
									key={`${i}-${option}`}
									type="button"
									onClick={() => void respond({ value: option })}
									onMouseEnter={() => setHighlight(i)}
									className={`group flex items-baseline gap-2 rounded-[9px] px-3 py-2.5 text-left text-[13px] text-ink-2 transition-colors ${
										i === highlight ? "bg-hover" : ""
									}`}
								>
									<span className="flex h-4 w-[18px] flex-none items-center justify-center rounded-[5px] bg-ink/6 text-[10px] text-ink-2 tabular-nums">
										{i + 1}
									</span>
									<span className="min-w-0 break-words leading-[1.5]">{option}</span>
								</button>
							))}
						</div>
					)}

					{shown.kind === "input" && (
						<InputBody
							inputRef={inputRef}
							placeholder={shown.placeholder}
							onSubmit={(value) => void respond({ value })}
						/>
					)}

					{shown.kind === "editor" && (
						<EditorBody
							editorRef={editorRef}
							prefill={shown.prefill}
							onSubmit={(value) => void respond({ value })}
						/>
					)}

					{shown.kind === "form" && (
						<FormFields
							questions={shown.questions ?? []}
							onSubmit={(answers) => void respond({ answers })}
							onCancel={() => void respond({ cancelled: true })}
						/>
					)}
					{shown.kind === "confirm" && shown.message && (
						<p className="text-[13px] leading-relaxed break-words whitespace-pre-wrap text-ink-2">
							{shown.message}
						</p>
					)}

					{error && (
						<p className="rounded-lg bg-hover px-2.5 py-1.5 text-[12px] break-all text-err">{error}</p>
					)}

					<div className={`flex items-center gap-0.5 ${shown.kind === "form" ? "hidden" : ""}`}>
						<span className="text-[11px] text-ink-faint">{hint}</span>
						<div className="ml-auto flex items-center gap-0.5">
							{shown.timeoutMs !== undefined && (
								<span className="mr-1 text-[11px] text-ink-faint">{t("interaction.timedOutNote")}</span>
							)}

							{shown.kind === "form" ? null : shown.kind === "confirm" ? (
								<>
									<GhostAction onClick={() => void respond({ cancelled: true })}>
										{t("interaction.no")}
									</GhostAction>
									<GhostAction strong onClick={() => void respond({ confirmed: true })}>
										{t("interaction.yes")}
									</GhostAction>
								</>
							) : (
								<>
									<GhostAction onClick={() => void respond({ cancelled: true })}>
										{t("interaction.cancel")}
									</GhostAction>
									{(shown.kind === "input" || shown.kind === "editor") && (
										<GhostAction
											strong
											onClick={() => {
												const value =
													shown.kind === "input"
														? (inputRef.current?.value ?? "")
														: (editorRef.current?.value ?? shown.prefill ?? "");
												void respond({ value });
											}}
										>
											{t("interaction.submit")}
										</GhostAction>
									)}
								</>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

function InputBody({
	inputRef,
	placeholder,
	onSubmit,
}: {
	inputRef: React.RefObject<HTMLInputElement | null>;
	placeholder?: string;
	onSubmit: (value: string) => void;
}) {
	return (
		<div className="flex items-center gap-2 border-b border-border px-0.5 pt-1 pb-1.5 focus-within:border-accent">
			<input
				ref={inputRef}
				type="text"
				placeholder={placeholder}
				className="min-w-0 flex-1 border-none bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-faint"
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.stopPropagation();
						onSubmit(e.currentTarget.value);
					}
				}}
			/>
		</div>
	);
}

function EditorBody({
	editorRef,
	prefill,
	onSubmit,
}: {
	editorRef: React.RefObject<HTMLTextAreaElement | null>;
	prefill?: string;
	onSubmit: (value: string) => void;
}) {
	return (
		<textarea
			ref={editorRef}
			defaultValue={prefill}
			spellCheck={false}
			rows={4}
			className="max-h-[200px] min-h-24 w-full resize-none rounded-[10px] bg-hover px-2.5 py-2 font-mono text-[12.5px] leading-relaxed break-words whitespace-pre-wrap text-ink-2 outline-none focus:ring-1 focus:ring-border-strong"
			onKeyDown={(e) => {
				if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
					e.preventDefault();
					e.stopPropagation();
					onSubmit(e.currentTarget.value);
				}
			}}
		/>
	);
}
