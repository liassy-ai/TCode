import type { SessionMeta } from "@tcode/shared";
import type { SidebarSession } from "../../lib/sidebar-groups";
import type { MenuAnchor } from "../ui/place-menu";
import { SessionRow } from "./SessionRow";

export function SidebarSessionList({
	sessions,
	activeSessionId,
	emptyLabel,
	showMoreLabel,
	hasMore,
	onShowMore,
	onSelect,
	onContextMenu,
}: {
	sessions: readonly SidebarSession[];
	activeSessionId: string | null;
	emptyLabel: string;
	showMoreLabel: string;

	hasMore: boolean;
	onShowMore: () => void;
	onSelect: (session: SessionMeta) => void;
	onContextMenu: (session: SessionMeta, anchor: MenuAnchor) => void;
}) {
	if (sessions.length === 0) {
		return <p className="py-1 pl-[30px] text-[12px] text-ink-faint">{emptyLabel}</p>;
	}
	return (
		<div>
			<div data-sidebar-session-list="" className="space-y-1">
				{sessions.map(({ session, pinned }) => (
					<SessionRow
						key={session.sessionId}
						session={session}
						active={session.sessionId === activeSessionId}
						pinned={pinned}
						onSelect={() => onSelect(session)}
						onContextMenu={(anchor) => onContextMenu(session, anchor)}
					/>
				))}
			</div>

			{hasMore && (
				<button
					type="button"
					data-sidebar-show-more=""
					className="flex h-[31px] w-full items-center rounded-[7px] pl-[30px] text-left text-[12px] text-ink-faint transition-colors hover:bg-hover hover:text-ink-2 focus-visible:bg-hover focus-visible:text-ink-2"
					onClick={onShowMore}
				>
					{showMoreLabel}
				</button>
			)}
		</div>
	);
}
