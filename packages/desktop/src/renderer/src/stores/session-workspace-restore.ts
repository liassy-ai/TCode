import { getPi } from "../api";
import { initDailyDir } from "../lib/daily";
import { useProjectsStore } from "./projects";
import { isWorkspaceRecording, resolveMembersByFile, useSessionWorkspaceStore } from "./session-workspace";
import {
	currentNavigationToken,
	currentUserIntentToken,
	isLatestNavigation,
	isLatestUserIntent,
	useSessionsStore,
} from "./sessions";

export async function restoreSessionWorkspace(): Promise<void> {
	if (useSessionWorkspaceStore.getState().members.length > 0) return;

	if (!isWorkspaceRecording()) return;

	if (useSessionsStore.getState().activeSessionId !== null) return;

	const epoch = useSessionWorkspaceStore.getState().epoch;
	const intentToken = currentUserIntentToken();
	const navToken = currentNavigationToken();

	const saved = await getPi()
		.loadUiState()
		.catch(() => null);
	if (!saved) return;
	const snapshot = saved.sessionWorkspace;
	if (!snapshot || snapshot.files.length === 0) return;
	if (useSessionWorkspaceStore.getState().epoch !== epoch) return;

	const catalog = await getPi()
		.listAllSessions()
		.catch(() => null);
	if (!catalog) {
		console.warn("会话目录读取失败，本次启动跳过工作区恢复（保留原快照）");
		return;
	}
	useProjectsStore.getState().adoptCatalog(catalog);

	await initDailyDir().catch(() => null);
	if (useSessionWorkspaceStore.getState().epoch !== epoch) return;

	const members = resolveMembersByFile(snapshot.files, catalog);
	const files = members.map((m) => m.file);
	const activeFile =
		snapshot.activeFile !== null && files.includes(snapshot.activeFile) ? snapshot.activeFile : null;

	const userTookOver =
		useSessionWorkspaceStore.getState().activeFile !== null ||
		!isLatestUserIntent(intentToken) ||
		!isLatestNavigation(navToken);
	useSessionWorkspaceStore.getState().hydrateFromSnapshot(members, userTookOver ? null : activeFile);

	if (activeFile === null || userTookOver) return;

	await useSessionsStore.getState().openFromHistory(activeFile);
}
