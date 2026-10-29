import { useT } from "../../i18n";
import type { SidebarSession } from "../../lib/sidebar-groups";
import { useLongPress } from "../../lib/use-long-press";
import { useProjectsStore } from "../../stores/projects";
import { CoffeeIcon, PinIcon } from "../icons";
import { sessionTitle, useSessionStatus } from "../session/session-status";
import { useSessionMenu } from "./SessionMenu";
import { DOT_CLASS } from "./SessionRow";

export function DailySessionCard({ item, active }: { item: SidebarSession; active: boolean }) {
	const t = useT();
	const openSession = useProjectsStore((s) => s.openSession);
	const title = sessionTitle(item.session, t("projects.untitled"), t("projects.daily"));
	const status = useSessionStatus(item.session.sessionId);
	const sessionMenu = useSessionMenu();

	const longPress = useLongPress((point) => {
		sessionMenu.open(item.session, { left: point.x, top: point.y, width: 0, height: 0 });
	});
	return (
		<div className="relative">
			<button
				type="button"
				data-session-id={item.session.sessionId}
				data-session-active={active ? "true" : "false"}
				className={`flex h-[30px] w-full items-center gap-2 rounded-[7px] px-1.5 text-left text-[14px] ${
					active ? "bg-bubble font-medium text-ink" : "text-ink-2 hover:bg-hover hover:text-ink"
				}`}
				onClick={() => void openSession(item.session)}
				onContextMenu={(e) => {
					e.preventDefault();
					sessionMenu.open(item.session, { left: e.clientX, top: e.clientY, width: 0, height: 0 });
				}}
				onPointerDown={longPress.onPointerDown}
				onPointerMove={longPress.onPointerMove}
				onPointerUp={longPress.onPointerUp}
				onPointerCancel={longPress.onPointerCancel}
			>
				<span className="grid h-4 w-4 shrink-0 place-items-center text-ink-faint" aria-hidden="true">
					<CoffeeIcon size={16} />
				</span>
				<span className="min-w-0 flex-1 truncate">{title}</span>
				{item.pinned && (
					<span className="grid h-4 w-4 shrink-0 place-items-center text-ink-faint" aria-hidden="true">
						<PinIcon size={12} />
					</span>
				)}
				{status !== "idle" && (
					<span
						className={`mr-0.5 h-[7px] w-[7px] shrink-0 rounded-full ${DOT_CLASS[status]}`}
						aria-hidden="true"
					/>
				)}
			</button>
			{sessionMenu.element}
		</div>
	);
}
