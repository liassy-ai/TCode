import { type CSSProperties, useEffect, useMemo, useRef } from "react";
import { useT } from "../../i18n";
import { deriveSidebarNavigation, orderMixedEntries } from "../../lib/sidebar-groups";
import { useEdgeFade } from "../../lib/use-edge-fade";
import { useProjectsStore } from "../../stores/projects";
import { useSessionsStore } from "../../stores/sessions";
import { selectSidebarHidden, useUiPreferencesStore } from "../../stores/ui-preferences";
import { ProjectSection } from "./ProjectSection";
import { SidebarFooter } from "./SidebarFooter";
import { SidebarHeader } from "./SidebarHeader";
import { useSidebarBatching } from "./useSidebarBatching";

export { SIDEBAR_WIDTH_PX } from "../../lib/layout-metrics";

export function Sidebar() {
	const t = useT();
	const collapsed = useUiPreferencesStore(selectSidebarHidden);
	const floating = useUiPreferencesStore((s) => s.sidebarFloating);
	const expandedGroups = useUiPreferencesStore((s) => s.expandedGroups);
	const expandedGroupsTouched = useUiPreferencesStore((s) => s.expandedGroupsTouched);
	const pinnedProjects = useUiPreferencesStore((s) => s.pinnedProjects);
	const pinnedSessions = useUiPreferencesStore((s) => s.pinnedSessions);
	const toggleProjectPin = useUiPreferencesStore((s) => s.toggleProjectPin);
	const search = useProjectsStore((s) => s.search);
	const allSessions = useProjectsStore((s) => s.allSessions);
	const addedProjects = useProjectsStore((s) => s.addedProjects);
	const deleteProject = useProjectsStore((s) => s.deleteProject);
	const activeSessionId = useSessionsStore((s) => s.activeSessionId);

	const memorySessions = useSessionsStore((s) => s.sessions);

	const activeCwd = useSessionsStore((s) => s.cwd);

	const data = useMemo(
		() =>
			deriveSidebarNavigation({
				history: allSessions,
				memory: memorySessions,
				addedProjects,
				search,
				activeCwd,
				pinnedSessions,
				pinnedProjects,
				expandedGroups,
				expandedGroupsTouched,
			}),
		[
			allSessions,
			memorySessions,
			addedProjects,
			search,
			activeCwd,
			pinnedSessions,
			pinnedProjects,
			expandedGroups,
			expandedGroupsTouched,
		],
	);

	const batching = useSidebarBatching({ search, defaults: data.defaultExpandedKeys });

	const entries = useMemo(
		() => orderMixedEntries(data.projects, data.daily?.sessions ?? [], pinnedProjects),
		[data, pinnedProjects],
	);
	const empty = entries.length === 0;

	const sidebarScrollRef = useRef<HTMLDivElement>(null);
	useEdgeFade(sidebarScrollRef);

	const asideRef = useRef<HTMLElement>(null);
	useEffect(() => {
		if (!floating || collapsed) return;
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target;
			if (!(target instanceof Node)) return;
			if (asideRef.current?.contains(target)) return;
			if (target instanceof Element && target.closest("[data-sidebar-toggle]")) return;
			useUiPreferencesStore.getState().toggleSidebarCollapsed();
		};

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") useUiPreferencesStore.getState().toggleSidebarCollapsed();
		};
		window.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [floating, collapsed]);

	return (
		<aside
			ref={asideRef}
			className={`sidebar ${collapsed ? "is-collapsed" : ""} ${floating ? "is-floating" : ""}`}
			aria-label={t("sidebar.title")}
		>
			<div className="sidebar-inner">
				<SidebarHeader />

				<div
					ref={sidebarScrollRef}
					data-sidebar-scroll-root=""
					style={{ "--edge-fade-size": "16px" } as CSSProperties}
					className="edge-fade min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pt-0.5 pb-4"
				>
					<ProjectSection
						entries={entries}
						activeSessionId={activeSessionId}
						batching={batching}
						onTogglePin={toggleProjectPin}
						onRemoveProject={(cwd) => {
							void deleteProject(cwd).then(
								() => batching.forget(cwd),
								(error: unknown) => console.error("移除项目失败", error),
							);
						}}
					/>
					{empty && (
						<p className="px-1.5 py-6 text-center text-[12px] text-ink-faint">
							{search ? t("sidebar.searchEmpty") : t("sidebar.noSessions")}
						</p>
					)}
				</div>
				<SidebarFooter />
			</div>
		</aside>
	);
}
