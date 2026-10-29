import type { SessionMeta } from "@tcode/shared";
import { deriveProjects, type ProjectEntry } from "../stores/projects";
import { partitionSessionsByPin } from "../stores/sessions";
import { getDailyDirCached } from "./daily";
import { isPrimaryNavigationSession } from "./session-visibility";

export { isPrimaryNavigationSession };

export type SidebarSession = {
	session: SessionMeta;
	pinned: boolean;
};

export type SidebarGroup = {
	key: string;
	kind: "daily" | "project";
	cwd: string;

	label: string | null;
	sessionCount: number;

	sessions: SidebarSession[];
	expanded: boolean;
};

export type SidebarProjectEntry = SidebarGroup & {
	pinned: boolean;

	totalSessions: number;

	lastActive: number;
};

export type SidebarGroupsResult = {
	daily: SidebarGroup | null;
	projects: SidebarProjectEntry[];

	defaultExpandedKeys: string[];
};

function mergeSessionMeta(history: SessionMeta, memory: SessionMeta): SessionMeta {
	return {
		...memory,
		createdAt: history.createdAt,
		modifiedAt: memory.modifiedAt ?? history.modifiedAt,
	};
}

export function mergeSidebarSessions(
	history: readonly SessionMeta[],
	memory: readonly SessionMeta[],
): SessionMeta[] {
	const byId = new Map<string, SessionMeta>();
	for (const session of history) byId.set(session.sessionId, session);
	for (const session of memory) {
		const previous = byId.get(session.sessionId);
		byId.set(session.sessionId, previous ? mergeSessionMeta(previous, session) : session);
	}
	return [...byId.values()];
}

export type SidebarGroupsInput = {
	sessions: readonly SessionMeta[];

	projects: readonly ProjectEntry[];

	search: string;

	activeCwd: string | null;
	pinnedSessions: readonly string[];
	pinnedProjects: readonly string[];

	expandedGroups: readonly string[];

	expandedGroupsTouched: boolean;
};

export type SidebarNavigationInput = {
	history: readonly SessionMeta[];

	memory: readonly SessionMeta[];

	addedProjects: string[];
	search: string;
	activeCwd: string | null;
	pinnedSessions: readonly string[];
	pinnedProjects: readonly string[];
	expandedGroups: readonly string[];
	expandedGroupsTouched: boolean;
};

function matchesSearch(session: SessionMeta, query: string): boolean {
	if (!query) return true;
	return (session.name ?? "").toLowerCase().includes(query) || session.sessionId.includes(query);
}

function groupSessions(list: readonly SessionMeta[], pinned: ReadonlySet<string>): SidebarSession[] {
	const sorted = [...list].sort((a, b) => (b.modifiedAt ?? b.createdAt) - (a.modifiedAt ?? a.createdAt));
	return partitionSessionsByPin(sorted, [...pinned]).map((session) => ({
		session,
		pinned: pinned.has(session.sessionId),
	}));
}

export function deriveSidebarGroups(input: SidebarGroupsInput): SidebarGroupsResult {
	const query = input.search.trim().toLowerCase();
	const visible = input.sessions.filter((session) => matchesSearch(session, query));
	const searching = query.length > 0;

	const byCwd = new Map<string, SessionMeta[]>();
	for (const session of visible) {
		const list = byCwd.get(session.cwd);
		if (list) list.push(session);
		else byCwd.set(session.cwd, [session]);
	}

	const pinnedSessions = new Set(input.pinnedSessions);

	const defaultExpandedKeys = input.activeCwd ? [input.activeCwd] : [];

	const expandedKeys = input.expandedGroupsTouched ? input.expandedGroups : defaultExpandedKeys;
	const isExpanded = (key: string) => expandedKeys.includes(key);

	const dailyCwd = getDailyDirCached();
	const dailySessions = dailyCwd ? (byCwd.get(dailyCwd) ?? []) : [];
	const daily =
		dailyCwd && (!searching || dailySessions.length > 0)
			? {
					key: dailyCwd,
					kind: "daily" as const,
					cwd: dailyCwd,
					label: null,
					sessionCount: dailySessions.length,
					sessions: groupSessions(dailySessions, pinnedSessions),
					expanded: isExpanded(dailyCwd),
				}
			: null;

	const matched = input.projects.filter((project) => !searching || (byCwd.get(project.cwd)?.length ?? 0) > 0);
	const byCwdProject = new Map(matched.map((project) => [project.cwd, project]));
	const pinnedProjects = input.pinnedProjects
		.map((cwd) => byCwdProject.get(cwd))
		.filter((project): project is ProjectEntry => project !== undefined);
	const pinnedSet = new Set(pinnedProjects.map((project) => project.cwd));
	const ordered = [...pinnedProjects, ...matched.filter((project) => !pinnedSet.has(project.cwd))];

	return {
		daily,
		projects: ordered.map((project) => {
			const sessions = byCwd.get(project.cwd) ?? [];
			return {
				key: project.cwd,
				kind: "project" as const,
				cwd: project.cwd,
				label: project.name,
				sessionCount: sessions.length,
				sessions: groupSessions(sessions, pinnedSessions),
				expanded: isExpanded(project.cwd),
				pinned: pinnedSet.has(project.cwd),
				totalSessions: project.sessionCount,
				lastActive: project.lastActive,
			};
		}),
		defaultExpandedKeys,
	};
}

export type MixedSidebarEntry =
	| { kind: "project"; project: SidebarProjectEntry }
	| { kind: "session"; item: SidebarSession };

export function orderMixedEntries(
	projects: readonly SidebarProjectEntry[],
	dailySessions: readonly SidebarSession[],
	pinnedProjects: readonly string[],
): MixedSidebarEntry[] {
	const pinnedSet = new Set(pinnedProjects);
	const pinned: MixedSidebarEntry[] = pinnedProjects
		.map((cwd) => projects.find((project) => project.cwd === cwd))
		.filter((project): project is SidebarProjectEntry => project !== undefined)
		.map((project) => ({ kind: "project" as const, project }));
	const rest: MixedSidebarEntry[] = [
		...projects
			.filter((project) => !pinnedSet.has(project.cwd))
			.map((project) => ({ kind: "project" as const, project })),
		...dailySessions.map((item) => ({ kind: "session" as const, item })),
	];
	const lastActive = (entry: MixedSidebarEntry): number =>
		entry.kind === "project"
			? entry.project.lastActive
			: (entry.item.session.modifiedAt ?? entry.item.session.createdAt);
	rest.sort((a, b) => lastActive(b) - lastActive(a));
	return [...pinned, ...rest];
}

export function primaryNavigationSessions(
	history: readonly SessionMeta[],
	memory: readonly SessionMeta[],
): SessionMeta[] {
	return mergeSidebarSessions(history, memory).filter(isPrimaryNavigationSession);
}

export function deriveSidebarNavigation(input: SidebarNavigationInput): SidebarGroupsResult {
	const sessions = primaryNavigationSessions(input.history, input.memory);
	return deriveSidebarGroups({
		sessions,
		projects: deriveProjects({ allSessions: sessions, addedProjects: input.addedProjects }),
		search: input.search,
		activeCwd: input.activeCwd,
		pinnedSessions: input.pinnedSessions,
		pinnedProjects: input.pinnedProjects,
		expandedGroups: input.expandedGroups,
		expandedGroupsTouched: input.expandedGroupsTouched,
	});
}

export function toggleExpandedGroup(
	current: readonly string[],
	key: string,
	defaults: readonly string[],
	touched: boolean = current.length > 0,
): string[] {
	const base = touched ? [...current] : [...defaults];
	return base.includes(key) ? base.filter((item) => item !== key) : [...base, key];
}
