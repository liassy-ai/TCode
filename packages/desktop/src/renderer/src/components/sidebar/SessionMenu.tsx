import type { SessionMeta } from "@tcode/shared";
import { useState } from "react";
import { useT } from "../../i18n";
import { useProjectsStore } from "../../stores/projects";
import { useUiPreferencesStore } from "../../stores/ui-preferences";
import { RenamePopover } from "../session/RenamePopover";
import {
	copySessionDiagnostics,
	renameSession,
	sessionMenuItems,
	sidebarMenuKind,
} from "../session/session-menu";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ContextMenu } from "../ui/ContextMenu";
import type { MenuAnchor } from "../ui/place-menu";

export function useSessionMenu() {
	const t = useT();
	const pinnedSessions = useUiPreferencesStore((s) => s.pinnedSessions);

	const archiveSession = useProjectsStore((s) => s.archiveSession);
	const [menu, setMenu] = useState<{ session: SessionMeta; anchor: MenuAnchor } | null>(null);
	const [renaming, setRenaming] = useState<{ session: SessionMeta; anchor: MenuAnchor } | null>(null);
	const [deleting, setDeleting] = useState<SessionMeta | null>(null);

	const open = (session: SessionMeta, anchor: MenuAnchor) => {
		if (sidebarMenuKind(session) === "none") return;
		setMenu({ session, anchor });
	};

	const element = (
		<>
			{menu && (
				<ContextMenu
					anchor={menu.anchor}
					onClose={() => setMenu(null)}
					items={sessionMenuItems(t, {
						sessionId: menu.session.sessionId,
						pinned: pinnedSessions.includes(menu.session.sessionId),
						onRename: () => setRenaming({ session: menu.session, anchor: menu.anchor }),
						onCopyDiagnostics: () => void copySessionDiagnostics(menu.session),
						onDelete: () => setDeleting(menu.session),
					})}
				/>
			)}
			{renaming && (
				<RenamePopover
					anchor={renaming.anchor}
					value={renaming.session.name ?? ""}
					onCommit={(name) => {
						setRenaming(null);
						renameSession(renaming.session.sessionId, name);
					}}
					onCancel={() => setRenaming(null)}
				/>
			)}
			{deleting && (
				<ConfirmDialog
					title={t("sessionMenu.archiveTitle")}
					description={t("sessionMenu.archiveDesc")}
					confirmLabel={t("sessionMenu.archive")}
					cancelLabel={t("common.cancel")}
					danger
					onConfirm={() => {
						void archiveSession(deleting);
						setDeleting(null);
					}}
					onCancel={() => setDeleting(null)}
				/>
			)}
		</>
	);

	return { open, element };
}
