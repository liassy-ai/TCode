import { useT } from "../../i18n";
import type { SidebarGroup as Group } from "../../lib/sidebar-groups";
import { hasMoreSessions, visibleSessions } from "../../lib/sidebar-visible-count";
import { COMPOSER_FOCUS_EVENT } from "../../stores/drafts";
import { useProjectsStore } from "../../stores/projects";
import { useSessionsStore } from "../../stores/sessions";
import { ProjectRow } from "./ProjectRow";
import { useSessionMenu } from "./SessionMenu";
import { SidebarSessionList } from "./SidebarSessionList";
import type { SidebarBatching } from "./useSidebarBatching";

export function SidebarGroup({
	group,
	activeSessionId,
	batching,
	pinned = false,
	totalSessions = 0,
	onTogglePin,
	onRemove,
}: {
	group: Group;
	activeSessionId: string | null;

	batching: SidebarBatching;
	pinned?: boolean;
	totalSessions?: number;
	onTogglePin?: (cwd: string) => void;
	onRemove?: () => void;
}) {
	const t = useT();
	const openSession = useProjectsStore((s) => s.openSession);
	const activateNewSessionDraftForCwd = useSessionsStore((s) => s.activateNewSessionDraftForCwd);
	const sessionMenu = useSessionMenu();
	const expanded = batching.isExpanded(group.key, group.expanded);
	const moreClicks = batching.moreClicks(group.key);
	const openNewSession = () => {
		activateNewSessionDraftForCwd(group.cwd);
		requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(COMPOSER_FOCUS_EVENT)));
	};
	return (
		<div data-sidebar-group-key={group.key}>
			<ProjectRow
				label={group.label ?? t("sidebar.daily")}
				kind={group.kind}
				expanded={expanded}
				pinned={pinned}
				totalSessions={totalSessions}
				onToggle={() => batching.toggleGroup(group.key, !expanded)}
				onNewSession={openNewSession}
				onTogglePin={onTogglePin ? () => onTogglePin(group.cwd) : undefined}
				onRemove={onRemove}
			/>
			<div
				data-sidebar-group-content={expanded ? "expanded" : "collapsed"}
				className={`sidebar-group-content ${expanded ? "is-expanded" : ""}`}
				aria-hidden={!expanded}
				inert={!expanded}
			>
				<div className="sidebar-group-content-inner">
					{group.kind === "project" && (
						<div
							data-sidebar-group-divider=""
							aria-hidden="true"
							className="mx-1.5 my-1 border-t border-border"
						/>
					)}
					<SidebarSessionList
						sessions={visibleSessions(group.sessions, moreClicks)}
						activeSessionId={activeSessionId}
						emptyLabel={t("sidebar.noSessions")}
						showMoreLabel={t("sidebar.showMore")}
						hasMore={hasMoreSessions(group.sessions.length, moreClicks)}
						onShowMore={() => batching.showMore(group.key)}
						onSelect={(session) => void openSession(session)}
						onContextMenu={(session, anchor) => sessionMenu.open(session, anchor)}
					/>
				</div>
			</div>
			{sessionMenu.element}
		</div>
	);
}
