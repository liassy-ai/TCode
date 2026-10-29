import { useState } from "react";
import { useT } from "../../i18n";
import { CoffeeIcon, EditIcon, FolderIcon, FolderOpenIcon, MoreIcon, PinIcon } from "../icons";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ContextMenu } from "../ui/ContextMenu";
import type { MenuAnchor } from "../ui/place-menu";
import { projectMenuItems } from "./ProjectMenu";

export function ProjectRow({
	label,
	kind,
	expanded,
	pinned = false,
	totalSessions = 0,
	onToggle,
	onNewSession,
	onTogglePin,
	onRemove,
}: {
	label: string;
	kind: "daily" | "project";
	expanded: boolean;
	pinned?: boolean;

	totalSessions?: number;
	onToggle: () => void;

	onNewSession: () => void;

	onTogglePin?: () => void;

	onRemove?: () => void;
}) {
	const t = useT();
	const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
	const [confirming, setConfirming] = useState(false);
	const togglePin = onTogglePin;
	const remove = onRemove;
	const icon =
		kind === "daily" ? (
			<CoffeeIcon size={16} />
		) : expanded ? (
			<FolderOpenIcon size={16} />
		) : (
			<FolderIcon size={16} />
		);
	return (
		<div className="group/row relative">
			<button
				type="button"
				aria-expanded={expanded}
				title={label}
				className={`flex w-full items-center gap-2 rounded-[7px] px-1.5 pr-12 text-[14px] text-ink-2 group-hover/row:bg-hover group-hover/row:text-ink ${kind === "project" ? "h-[30px]" : "h-[34px]"} ${
					expanded ? "text-ink" : ""
				}`}
				onClick={onToggle}
			>
				<span className="grid h-4 w-4 shrink-0 place-items-center" aria-hidden="true">
					{icon}
				</span>
				<span className="min-w-0 flex-1 truncate text-left font-medium">{label}</span>
				{pinned && (
					<span className="grid h-4 w-4 shrink-0 place-items-center text-ink-faint" aria-hidden="true">
						<PinIcon size={12} />
					</span>
				)}
			</button>
			<div className="pointer-events-none absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover/row:pointer-events-auto group-hover/row:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
				{togglePin && (
					<button
						type="button"
						aria-label={t("sidebar.more")}
						className="flex h-5 w-5 items-center justify-center rounded-md text-ink-dim hover:bg-hover hover:text-ink focus-visible:text-ink"
						onClick={(e) => {
							setAnchor({ left: e.clientX, top: e.clientY, width: 0, height: 0 });
						}}
					>
						<MoreIcon size={14} />
					</button>
				)}
				<button
					type="button"
					aria-label={t("sidebar.newSessionInProject", { name: label })}
					className="flex h-5 w-5 items-center justify-center rounded-md text-ink-dim hover:bg-hover hover:text-ink focus-visible:text-ink"
					onClick={onNewSession}
				>
					<EditIcon size={14} />
				</button>
			</div>
			{anchor && togglePin && (
				<ContextMenu
					anchor={anchor}
					items={projectMenuItems(t, {
						pinned,
						onTogglePin: togglePin,
						onRemove: remove ? () => setConfirming(true) : undefined,
					})}
					onClose={() => setAnchor(null)}
				/>
			)}
			{confirming && remove && (
				<ConfirmDialog
					danger
					title={t("sidebar.removeProjectTitle", { name: label })}
					description={
						totalSessions > 0
							? t("sidebar.removeProjectDesc", { count: totalSessions })
							: t("sidebar.removeProjectDescEmpty")
					}
					confirmLabel={t("sidebar.removeProject")}
					cancelLabel={t("common.cancel")}
					onConfirm={() => {
						setConfirming(false);
						remove();
					}}
					onCancel={() => setConfirming(false)}
				/>
			)}
		</div>
	);
}
