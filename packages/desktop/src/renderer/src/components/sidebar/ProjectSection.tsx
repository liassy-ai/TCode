import { useT } from "../../i18n";
import type { MixedSidebarEntry } from "../../lib/sidebar-groups";
import { useProjectsStore } from "../../stores/projects";
import { PlusIcon } from "../icons";
import { DailySessionCard } from "./DailySessionCard";
import { SidebarGroup } from "./SidebarGroup";
import type { SidebarBatching } from "./useSidebarBatching";

export function ProjectSection({
	entries,
	activeSessionId,
	batching,
	onTogglePin,
	onRemoveProject,
}: {
	entries: MixedSidebarEntry[];
	activeSessionId: string | null;
	batching: SidebarBatching;
	onTogglePin: (cwd: string) => void;
	onRemoveProject: (cwd: string) => void;
}) {
	const t = useT();
	const addProject = useProjectsStore((s) => s.addProject);
	return (
		<div>
			<div className="group/sect mt-2 flex h-8 items-center gap-[5px] rounded-[7px] px-[6px] text-[15px] font-medium text-ink-dim">
				<span className="min-w-0 flex-1 truncate">{t("sidebar.projectsSection")}</span>
				<button
					type="button"
					aria-label={t("sidebar.addProject")}
					className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-ink-dim transition-colors hover:bg-hover hover:text-ink"
					onClick={() => void addProject()}
				>
					<PlusIcon size={15} />
				</button>
			</div>
			{entries.map((entry) =>
				entry.kind === "project" ? (
					<div
						key={entry.project.cwd}
						data-sidebar-project-frame=""
						className="mt-1.5 rounded-[10px] border border-border p-1"
					>
						<SidebarGroup
							group={entry.project}
							activeSessionId={activeSessionId}
							pinned={entry.project.pinned}
							totalSessions={entry.project.totalSessions}
							batching={batching}
							onTogglePin={onTogglePin}
							onRemove={() => onRemoveProject(entry.project.cwd)}
						/>
					</div>
				) : (
					<div
						key={entry.item.session.sessionId}
						data-sidebar-daily-frame=""
						className="mt-1.5 rounded-[10px] border border-border p-1"
					>
						<DailySessionCard item={entry.item} active={entry.item.session.sessionId === activeSessionId} />
					</div>
				),
			)}
		</div>
	);
}
