import type { ImageInput, UiError } from "@tcode/shared";
import { useEffect, useRef, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { randomUid } from "../../lib/uid";
import type { DraftAnnotation } from "../../stores/drafts";
import { useSessionsStore } from "../../stores/sessions";
import { useSettingsStore } from "../../stores/settings";
import { pushToast } from "../../stores/toasts";
import { useTranscriptStore } from "../../stores/transcript";
import { splitQueuedForDraft } from "./queued-text";
import { buildQuoteBlock } from "./quote";
import { buildSendUiError } from "./send-error";
import { createSendGuard } from "./send-guard";

export interface UseComposerSendOptions {
	activeSessionId: string | null;
	text: string;
	images: ImageInput[];
	attachments: string[];
	quotes: string[];
	annotations: DraftAnnotation[];
	slashCommand: string | null;
	followUpQueue: string[];

	compacting: boolean;

	imagesSupported: boolean;

	agentActive: boolean;
	setText: (updater: string | ((prev: string) => string)) => void;
	setImages: (updater: ImageInput[] | ((prev: ImageInput[]) => ImageInput[])) => void;
	setAttachments: (updater: string[] | ((prev: string[]) => string[])) => void;
	setQuotes: (updater: string[] | ((prev: string[]) => string[])) => void;
	setAnnotations: (updater: DraftAnnotation[] | ((prev: DraftAnnotation[]) => DraftAnnotation[])) => void;
	setSlashCommand: (command: string | null) => void;
}

function withSubagentDirective(content: string): string {
	const agents = useSettingsStore.getState().subagents;
	if (agents.length === 0) return content;
	const named = agents.filter((agent) =>
		new RegExp(`(^|\\\\s)@${agent.name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}(?=\\\\s|$)`).test(
			content,
		),
	);
	if (named.length === 0) return content;
	const names = named.map((agent) => agent.name).join(", ");
	return (
		`[System directive] The user explicitly designated subagent(s) with @: ${names}. ` +
		`You MUST delegate this turn to them via the subagent tool (agent="${names}") and wait for the result, ` +
		"then answer based on what it returns. Do not do the task yourself, do not pick a different agent, " +
		"and do not skip the delegation - ignoring this directive is a failed turn.\\n\\n" +
		content
	);
}
export function useComposerSend(options: UseComposerSendOptions) {
	const t = useT();
	const [sending, setSending] = useState(false);
	const [error, setErrorState] = useState<UiError | null>(null);
	const [feedback, setFeedback] = useState<{ message: string; tone: "info" | "warn" } | null>(null);
	const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const sendGuard = useRef(createSendGuard());

	const setError = (message: string | null) => setErrorState(message ? buildSendUiError(message) : null);

	const showFeedback = (message: string, tone: "info" | "warn" = "info") => {
		setFeedback({ message, tone });
		if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
		feedbackTimer.current = setTimeout(() => setFeedback(null), 2500);
	};

	const ensureSession = async (): Promise<string | null> => {
		const current = useSessionsStore.getState().activeSessionId;
		if (current) return current;

		if (!useSessionsStore.getState().newSessionDraft) {
			useSessionsStore.getState().activateNewSessionDraft();
		}

		return useSessionsStore.getState().createSession();
	};

	const runSlashCommand = async (content: string, sessionId: string): Promise<boolean> => {
		const [name, ...rest] = content.slice(1).split(/\s+/);
		const arg = rest.join(" ").trim();
		const pi = getPi();
		switch (name) {
			case "compact":
				try {
					await pi.compact({ sessionId, customInstructions: arg || undefined });
				} catch {}
				return true;
			case "name":
				if (arg) {
					await pi.setSessionName({ sessionId, name: arg });
					showFeedback(t("slash.feedback.renamed", { name: arg }));
					return true;
				}
				showFeedback(t("slash.feedback.noName"), "warn");
				return true;
			case "export": {
				const format = arg === "html" ? "html" : arg === "jsonl" ? "jsonl" : "jsonl";
				const contentOut = await pi.exportSession({ sessionId, format });
				const path = await pi.saveFileDialog({
					defaultName: `pi-session-${Date.now()}.${format}`,
					content: contentOut,
				});
				showFeedback(path ? t("slash.feedback.exported", { path }) : t("slash.feedback.exportCancelled"));
				return true;
			}
			case "settings":
				useSettingsStore.getState().openWith();
				return true;
			default:
				return false;
		}
	};

	const sendNow = async (sent: {
		content: string;
		text: string;
		images: ImageInput[];
		attachments: string[];
		quotes: string[];
		annotations: DraftAnnotation[];
		wasActive: boolean;
	}): Promise<void> => {
		const { content, text, images, attachments, quotes, annotations, wasActive } = sent;
		let sessionId = options.activeSessionId;
		if (content.startsWith("/") && images.length === 0) {
			sessionId = await ensureSession();
			if (!sessionId) {
				showFeedback(t("slash.feedback.noSession"), "warn");
				return;
			}
			options.setText("");
			options.setSlashCommand(null);
			options.setQuotes([]);
			options.setAnnotations([]);
			try {
				const handled = await runSlashCommand(content, sessionId);
				if (handled) return;
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
				return;
			}
		} else if (!sessionId) {
			sessionId = await ensureSession();
			if (!sessionId) {
				showFeedback(t("slash.feedback.noSession"), "warn");
				return;
			}
		}

		options.setText("");
		options.setSlashCommand(null);
		options.setQuotes([]);
		options.setAnnotations([]);
		setSending(true);
		setError(null);
		const sentImages = images;
		const sentAttachments = attachments;
		const sentQuotes = quotes;
		const sentAnnotations = annotations;
		options.setImages([]);
		options.setAttachments([]);
		options.setQuotes([]);

		useTranscriptStore.getState().markAgentActive(sessionId, true);
		try {
			await getPi().prompt({
				sessionId,
				text: withSubagentDirective(content),
				images: sentImages.length > 0 ? sentImages : undefined,
			});
		} catch (err) {
			useTranscriptStore.getState().markAgentActive(sessionId, wasActive);
			setError(err instanceof Error ? err.message : String(err));
			options.setImages(sentImages);
			options.setAttachments(sentAttachments);
			options.setQuotes(sentQuotes);
			options.setAnnotations(sentAnnotations);

			if (text.trim()) options.setText(text);
		} finally {
			setSending(false);
		}
	};

	const handleSend = async () => {
		const {
			text,
			images,
			attachments,
			quotes,
			annotations,
			slashCommand,
			followUpQueue,
			compacting,
			agentActive,
		} = options;

		const quoteBlock = buildQuoteBlock(quotes);
		const atText = attachments.map((p) => `@${p}`).join(" ");
		const body = [atText, text.trim()].filter(Boolean).join("\n");
		const annotationText = annotations.map((a) => a.command).join("\n");
		const content = [
			quoteBlock,
			slashCommand ? `/${slashCommand}${body ? ` ${body}` : ""}` : body,
			annotationText,
		]
			.filter(Boolean)
			.join("\n\n");

		if ((!content && images.length === 0) || sending) return;

		if (compacting) {
			showFeedback(t("composer.compacting"), "warn");
			return;
		}

		if (images.length > 0 && !options.imagesSupported) {
			pushToast("warning", "composer.imageUnsupported");
			return;
		}

		if (followUpQueue.length >= 1 && !content.startsWith("/")) {
			showFeedback(t("composer.queueFull"), "warn");
			return;
		}

		if (!sendGuard.current.tryAcquire()) return;
		try {
			await sendNow({ content, text, images, attachments, quotes, annotations, wasActive: agentActive });
		} finally {
			sendGuard.current.release();
		}
	};

	const restoreQueuedIntoDraft = (raws: string[], setText: UseComposerSendOptions["setText"]) => {
		const { text, commands } = splitQueuedForDraft(raws);
		if (text) setText((prev) => (prev ? `${prev}\n${text}` : text));
		if (commands.length > 0) {
			options.setAnnotations((prev) => [
				...prev.filter((annotation) => !commands.includes(annotation.command)),
				...commands.map((command) => ({ id: randomUid(), command })),
			]);
		}
	};

	const handleStop = async () => {
		const { activeSessionId, setText } = options;
		if (!activeSessionId) return;
		useTranscriptStore.getState().setFollowUpQueue(activeSessionId, []);
		const cleared = await getPi().clearQueue({ sessionId: activeSessionId });
		restoreQueuedIntoDraft(cleared.followUp, setText);
		await getPi().abort({ sessionId: activeSessionId });
	};

	const handleRestoreQueue = async (focus: () => void) => {
		const { activeSessionId, setText } = options;
		if (!activeSessionId) return;
		useTranscriptStore.getState().setFollowUpQueue(activeSessionId, []);
		const cleared = await getPi().clearQueue({ sessionId: activeSessionId });

		restoreQueuedIntoDraft(cleared.followUp, setText);
		requestAnimationFrame(focus);
	};

	useEffect(() => {
		return () => {
			if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
		};
	}, []);

	return {
		sending,
		error,
		setError,
		feedback,
		showFeedback,
		ensureSession,
		runSlashCommand,
		handleSend,
		handleStop,
		handleRestoreQueue,
	};
}
