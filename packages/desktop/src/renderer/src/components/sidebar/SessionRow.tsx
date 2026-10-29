import type { SessionMeta } from "@tcode/shared";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useT } from "../../i18n";
import { useLongPress } from "../../lib/use-long-press";
import { PinIcon } from "../icons";
import { sessionTitle, useSessionStatus } from "../session/session-status";
import type { MenuAnchor } from "../ui/place-menu";

export const DOT_CLASS: Record<string, string> = {
	attention: "bg-amber-500",
	working: "bg-ink sidebar-dot-working",
	done: "bg-green-500",
};

export function SessionRow({
	session,
	active,
	pinned = false,
	onSelect,
	onContextMenu,
}: {
	session: SessionMeta;
	active: boolean;
	pinned?: boolean;
	onSelect: () => void;
	onContextMenu?: (anchor: MenuAnchor) => void;
}) {
	const t = useT();
	const status = useSessionStatus(session.sessionId);
	const title = sessionTitle(session, t("projects.untitled"), t("projects.daily"));

	const longPress = useLongPress((point) => {
		onContextMenu?.({ left: point.x, top: point.y, width: 0, height: 0 });
	});
	return (
		<button
			type="button"
			data-session-id={session.sessionId}
			data-session-active={active ? "true" : "false"}
			className={`flex h-[31px] w-full items-center gap-2 rounded-[7px] px-1.5 text-left text-[13.5px] ${
				active ? "bg-bubble font-medium text-ink" : "text-ink-2 hover:bg-hover hover:text-ink"
			}`}
			onClick={onSelect}
			onContextMenu={
				onContextMenu
					? (e: ReactMouseEvent<HTMLButtonElement>) => {
							e.preventDefault();

							onContextMenu({ left: e.clientX, top: e.clientY, width: 0, height: 0 });
						}
					: undefined
			}
			onPointerDown={longPress.onPointerDown}
			onPointerMove={longPress.onPointerMove}
			onPointerUp={longPress.onPointerUp}
			onPointerCancel={longPress.onPointerCancel}
		>
			<span className="grid h-4 w-4 shrink-0 place-items-center text-ink-faint" aria-hidden="true">
				{pinned && <PinIcon size={12} />}
			</span>
			<span className="min-w-0 flex-1 truncate">{title}</span>
			{status !== "idle" && (
				<span
					className={`mr-0.5 h-[7px] w-[7px] shrink-0 rounded-full ${DOT_CLASS[status]}`}
					aria-hidden="true"
				/>
			)}
		</button>
	);
}
