import { useProjectsStore } from "../stores/projects";
import { useSessionsStore } from "../stores/sessions";

export async function backfillStartupCwd(projectsReady: Promise<void> | null): Promise<void> {
	if (useSessionsStore.getState().cwd) return;

	await (projectsReady ?? useProjectsStore.getState().load()).catch(() => undefined);

	const state = useSessionsStore.getState();
	if (state.cwd || state.activeSessionId !== null) return;

	const cwd = pickStartupCwd();
	if (!cwd) return;

	state.setDraftCwd(cwd);
}

function pickStartupCwd(): string | null {
	const projects = useProjectsStore.getState();
	if (projects.selectedCwd) return projects.selectedCwd;

	const recent = projects.allSessions.find((s) => typeof s.cwd === "string" && s.cwd.trim() !== "");
	return recent?.cwd ?? null;
}
