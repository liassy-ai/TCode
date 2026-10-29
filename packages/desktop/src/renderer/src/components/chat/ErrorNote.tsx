import type { UIMessage, UiError } from "@tcode/shared";
import { useMemo, useState } from "react";
import { getPi } from "../../api";
import { useSessionReadOnly } from "../../hooks/use-session-state";
import { type MessageKey, useT } from "../../i18n";
import { useSessionsStore } from "../../stores/sessions";
import { useSettingsStore } from "../../stores/settings";
import { useTranscriptStore } from "../../stores/transcript";
import { ChevronRightIcon, CopyIcon, ErrorCircleIcon, GearIcon, RefreshIcon } from "../icons";

export function ErrorNote({
	sessionId,
	cardId,
	error,
}: {
	sessionId: string | null;
	cardId: string;
	error: UiError;
}) {
	const t = useT();
	const [copied, setCopied] = useState(false);

	const readOnly = useSessionReadOnly(sessionId);

	const lastUser = useTranscriptStore((s) => {
		if (!sessionId) return undefined;
		const entry = s.bySession[sessionId];
		const messages = entry?.messages ?? [];
		const idx = messages.findLastIndex((m) => m.kind === "error" && m.id === cardId);
		if (idx < 0) return undefined;
		for (let i = idx - 1; i >= 0; i--) {
			const m = messages[i];
			if (m?.kind === "user") return m;
		}
		return undefined;
	});

	const retry = async () => {
		if (readOnly || !sessionId || !lastUser) return;
		const user = lastUser as Extract<UIMessage, { kind: "user" }>;
		const text = user.sourceText ?? user.text;
		const images = user.images;
		useTranscriptStore.getState().markAgentActive(sessionId, true);
		try {
			await getPi().prompt({ sessionId, text, images: images.length > 0 ? images : undefined });

			useSessionsStore.getState().switchSession(sessionId);
		} catch {
			useTranscriptStore.getState().markAgentActive(sessionId, false);
		}
	};

	const copyDetail = async () => {
		if (!error.detail) return;
		try {
			await navigator.clipboard.writeText(error.detail);
			setCopied(true);
			setTimeout(() => setCopied(false), 1800);
		} catch {}
	};

	const meta = `${t(`error.meta.${error.source}`)} · ${formatTime(error.timestamp)}`;
	const severityClass =
		error.severity === "warning" ? "text-warn" : error.severity === "info" ? "text-info" : "text-err";

	const actions = useMemo(() => {
		const list = [];
		for (const action of error.actions) {
			if (readOnly && (action === "retry" || action === "compact")) continue;
			if (action === "retry") list.push({ action, label: t("error.action.retry") });
			else if (action === "compact") list.push({ action, label: t("error.action.compact") });
			else if (action === "openSettings") list.push({ action, label: t("error.action.openSettings") });
			else if (action === "copyDetail") list.push({ action, label: t("error.action.copyDetail") });
		}
		return list;
	}, [error.actions, t, readOnly]);

	return (
		<details className="error-note drawer-details">
			<summary>
				<span className={`error-note-sev ${severityClass}`}>
					<ErrorCircleIcon />
				</span>
				<span className="error-note-title truncate">
					{t(error.titleKey as MessageKey, error.titleParams)}
				</span>
				<span className="error-note-meta">{meta}</span>
				<span className="error-note-chev">
					<ChevronRightIcon />
				</span>
			</summary>
			<div className="drawer-body">
				<div className="error-note-body">
					{error.detail && <pre className="error-note-detail">{error.detail}</pre>}
					{error.hintKey && <p className="error-note-hint">{t(error.hintKey as MessageKey)}</p>}
					<div className="error-note-actions">
						{actions.map(({ action, label }) => (
							<button
								key={action}
								type="button"
								className={`error-note-act${action === "retry" ? " strong" : ""}`}
								onClick={() => {
									if (action === "retry") void retry();
									else if (action === "compact" && sessionId) void getPi().compact({ sessionId });
									else if (action === "openSettings") useSettingsStore.getState().openWith();
									else if (action === "copyDetail") void copyDetail();
								}}
							>
								{action === "retry" ? (
									<RefreshIcon />
								) : action === "openSettings" ? (
									<GearIcon />
								) : action === "copyDetail" ? (
									<CopyIcon />
								) : null}
								{label}
							</button>
						))}
						{error.detail && (
							<span className={`error-note-copied${copied ? " on" : ""}`}>{t("error.copied")}</span>
						)}
					</div>
				</div>
			</div>
		</details>
	);
}

function formatTime(timestamp: number): string {
	try {
		return new Date(timestamp).toLocaleTimeString(undefined, {
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		});
	} catch {
		return "";
	}
}
