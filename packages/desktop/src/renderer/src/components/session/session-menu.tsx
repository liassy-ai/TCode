import type { SessionMeta } from "@tcode/shared";
import { getPi } from "../../api";
import type { Translate } from "../../i18n";
import { buildDiagnosticsText } from "../../lib/diagnostics";
import { useProjectsStore } from "../../stores/projects";
import { useSessionsStore } from "../../stores/sessions";
import { useToastsStore } from "../../stores/toasts";
import { useUiPreferencesStore } from "../../stores/ui-preferences";
import { CopyIcon, PencilIcon, PinIcon, TrashIcon } from "../icons";
import type { ContextMenuItem } from "../ui/ContextMenu";

export function canOpenSessionMenu(session: SessionMeta | undefined): boolean {
	return !!session && !session.readOnly;
}

export function sidebarMenuKind(session: SessionMeta | undefined): "session" | "none" {
	return canOpenSessionMenu(session) ? "session" : "none";
}

export function toggleSessionPin(sessionId: string): void {
	useUiPreferencesStore.getState().togglePin(sessionId);
}

export function renameSession(sessionId: string, name: string): void {
	if (!name) return;
	getPi()
		.setSessionName({ sessionId, name })
		.then(() => {
			useSessionsStore.getState().updateSessionName(sessionId, name);
			useProjectsStore.getState().applySessionName(sessionId, name);
		})
		.catch((error) => {
			console.error("重命名失败", error);
			useToastsStore.getState().push("error", "toast.sessionRenameFailed");
		});
}

export async function copySessionDiagnostics(session: SessionMeta): Promise<void> {
	try {
		const info = await getPi()
			.getAppInfo()
			.catch(() => null);
		const text = buildDiagnosticsText(session, {
			platform: getPi().platform,
			appVersion: info?.version ?? "unknown",
		});
		await navigator.clipboard.writeText(text);
	} catch {}
}

export function sessionMenuItems(
	t: Translate,
	options: {
		sessionId: string;
		pinned: boolean;
		onRename: () => void;
		onCopyDiagnostics?: () => void;
		onDelete?: () => void;
	},
): ContextMenuItem[] {
	return [
		{ key: "rename", label: t("tabbar.rename"), icon: <PencilIcon size={13} />, onSelect: options.onRename },
		{
			key: "pin",
			label: options.pinned ? t("tabbar.unpin") : t("tabbar.pin"),
			icon: <PinIcon size={13} />,
			onSelect: () => toggleSessionPin(options.sessionId),
		},
		...(options.onCopyDiagnostics
			? [
					{
						key: "copy",
						label: t("sessionMenu.copyDiagnostics"),
						icon: <CopyIcon size={13} />,
						onSelect: options.onCopyDiagnostics,
					} satisfies ContextMenuItem,
				]
			: []),
		...(options.onDelete
			? [
					{
						key: "delete",
						label: t("sessionMenu.archive"),
						icon: <TrashIcon size={13} />,
						separatorBefore: true,
						danger: true,
						onSelect: options.onDelete,
					} satisfies ContextMenuItem,
				]
			: []),
	];
}
