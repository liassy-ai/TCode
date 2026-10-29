import type { PermissionRequest } from "@tcode/shared";
import { useCallback, useEffect, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { useTranscriptStore } from "../../stores/transcript";
import { WarningIcon } from "../icons";

const EXIT_MS = 150;

export function ApprovalDock({ sessionId }: { sessionId: string | null }) {
	const t = useT();
	const pending = useTranscriptStore((s) =>
		sessionId ? s.bySession[sessionId]?.pendingPermissions : undefined,
	);
	const resolvePermission = useTranscriptStore((s) => s.resolvePermission);
	const request = pending?.[0] ?? null;
	const queueCount = (pending?.length ?? 1) - 1;

	const [shown, setShown] = useState<PermissionRequest | null>(null);
	const [leaving, setLeaving] = useState(false);

	const [error, setError] = useState<string | null>(null);
	const [sending, setSending] = useState(false);
	useEffect(() => {
		if (request) {
			setShown(request);
			setLeaving(false);
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

	const respond = useCallback(
		async (answer: "allow" | "deny" | "allowAlways" | "allowDir") => {
			if (!shown || leaving || !sessionId || sending) return;
			setSending(true);
			setError(null);
			try {
				await getPi().respondPermission({ requestId: shown.id, answer });
				resolvePermission(sessionId, shown.id);
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			} finally {
				setSending(false);
			}
		},
		[shown, leaving, sessionId, sending, resolvePermission],
	);

	useEffect(() => {
		if (!shown || leaving || !sessionId) return;
		const onKeyDown = (e: KeyboardEvent) => {
			const answer =
				e.key === "Enter"
					? "allow"
					: e.key === "Escape"
						? "deny"
						: e.key === "a" || e.key === "A"
							? "allowAlways"
							: (e.key === "d" || e.key === "D") && shown.suggestDir
								? "allowDir"
								: null;
			if (!answer) return;
			e.preventDefault();
			void respond(answer);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [shown, leaving, sessionId, respond]);

	if (!shown) return null;

	const hintParams = {
		allowOnce: t("permission.allowOnce"),
		always: t("permissionShort.always"),
		dir: t("permissionShort.dir"),
		deny: t("permission.deny"),
	};

	return (
		<div className="relative z-20 shrink-0 px-6 pb-3">
			<div className="mx-auto max-w-[760px]">
				<div
					key={shown.id}
					role="dialog"
					aria-modal
					className={`flex flex-col gap-2.5 rounded-[14px] bg-surface px-3.5 pt-3 pb-2.5 shadow-soft outline-none ${
						leaving ? "dock-exit" : "dock-in"
					}`}
				>
					<div className="flex min-h-5 items-center gap-2">
						<span className="flex-none text-warn" aria-hidden="true">
							<WarningIcon />
						</span>
						<h3 className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium text-ink-2">
							{shown.title}
						</h3>
						{queueCount > 0 && (
							<span className="shrink-0 text-[11px] text-ink-faint">
								{t("permission.queued", { count: queueCount })}
							</span>
						)}
					</div>
					<p className="max-h-32 overflow-y-auto rounded-lg bg-hover p-2.5 font-mono text-[12px] leading-relaxed break-all whitespace-pre-wrap text-ink-2 select-text">
						{shown.message}
					</p>
					{error && (
						<p className="rounded-lg bg-hover px-2.5 py-1.5 text-[12px] break-all text-err">{error}</p>
					)}
					<div className="flex flex-wrap items-center gap-0.5">
						<span className="text-[11px] text-ink-faint">
							{shown.suggestDir
								? t("interaction.hintPermissionDir", hintParams)
								: t("interaction.hintPermission", hintParams)}
						</span>
						<div className="ml-auto flex flex-wrap items-center gap-0.5">
							<GhostAction onClick={() => respond("deny")}>{t("permission.deny")}</GhostAction>
							{shown.suggestDir && (
								<GhostAction onClick={() => respond("allowDir")}>{t("permission.allowDir")}</GhostAction>
							)}
							<GhostAction onClick={() => respond("allowAlways")}>{t("permission.allowAlways")}</GhostAction>
							<GhostAction strong onClick={() => respond("allow")}>
								{t("permission.allowOnce")}
							</GhostAction>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

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
