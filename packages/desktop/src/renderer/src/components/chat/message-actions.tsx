import { useEffect, useRef, useState } from "react";
import { useSessionBusy, useSessionReadOnly } from "../../hooks/use-session-state";
import { useT } from "../../i18n";
import { copyText } from "../../lib/clipboard";
import { useSessionsStore } from "../../stores/sessions";
import { CopyActionIcon, CopyCheckIcon, ForkIcon, UndoIcon } from "../icons";
import { anchorOfElement, type MenuAnchor } from "../ui/place-menu";

export function CopyButton({ text }: { text: string }) {
	const t = useT();
	const [copied, setCopied] = useState(false);
	const timerRef = useRef(0);

	useEffect(() => () => window.clearTimeout(timerRef.current), []);

	const handleCopy = () => {
		void copyText(text).then((ok) => {
			if (!ok) return;
			setCopied(true);
			window.clearTimeout(timerRef.current);
			timerRef.current = window.setTimeout(() => setCopied(false), 1200);
		});
	};

	return (
		<button
			type="button"
			onClick={handleCopy}
			aria-label={copied ? t("message.copied") : t("message.copy")}
			className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors duration-150 hover:bg-border/70 hover:text-ink-2 disabled:cursor-not-allowed"
		>
			{copied ? <CopyCheckIcon className="text-green-500" /> : <CopyActionIcon />}
		</button>
	);
}

export function ForkButton({
	entryId,
	matchText,
	sessionId,
}: {
	entryId?: string;
	matchText: string;
	sessionId: string | null;
}) {
	const t = useT();
	const sessionBusy = useSessionBusy(sessionId);
	const forkSession = useSessionsStore((s) => s.forkSession);
	const [forking, setForking] = useState(false);

	const readOnly = useSessionReadOnly(sessionId);
	if (readOnly) return null;

	const handleFork = () => {
		if (forking || sessionBusy) return;
		setForking(true);

		void forkSession(entryId ? { entryId } : { text: matchText }).finally(() => setForking(false));
	};

	return (
		<button
			type="button"
			onClick={handleFork}
			disabled={sessionBusy || forking}
			aria-label={t("message.fork")}
			className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors duration-150 hover:bg-border/70 hover:text-ink-2 disabled:cursor-not-allowed"
		>
			<ForkIcon />
		</button>
	);
}

export function RecallButton({
	entryId,
	matchText,
	timestamp,
	sessionId,
}: {
	entryId?: string;
	matchText: string;
	timestamp: number;
	sessionId: string | null;
}) {
	const t = useT();
	const sessionBusy = useSessionBusy(sessionId);
	const recallMessage = useSessionsStore((s) => s.recallMessage);
	const [recalling, setRecalling] = useState(false);

	const readOnly = useSessionReadOnly(sessionId);
	if (readOnly) return null;

	const handleRecall = (anchor: MenuAnchor) => {
		if (recalling || sessionBusy) return;
		setRecalling(true);

		void recallMessage({ entryId, text: matchText || undefined, timestamp }, anchor).finally(() =>
			setRecalling(false),
		);
	};

	return (
		<button
			type="button"
			onClick={(e) => handleRecall(anchorOfElement(e.currentTarget))}
			disabled={sessionBusy || recalling}
			aria-label={t("message.recall")}
			className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors duration-150 hover:bg-border/70 hover:text-ink-2 disabled:cursor-not-allowed"
		>
			<UndoIcon />
		</button>
	);
}
