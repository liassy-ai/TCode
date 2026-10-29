import { useCallback } from "react";
import { useProjectsStore } from "../stores/projects";
import {
	resolveWorkspaceSessions,
	useSessionWorkspaceStore,
	type WorkspaceMember,
} from "../stores/session-workspace";
import { useSessionsStore } from "../stores/sessions";

export function useWorkspaceRemoval(): (member: WorkspaceMember) => void {
	const removeFromWorkspace = useSessionWorkspaceStore((s) => s.removeMember);

	return useCallback(
		(member: WorkspaceMember) => {
			const result = removeFromWorkspace(member.file);

			if (!result?.wasActive) return;
			const next = result.next;
			if (!next) {
				useSessionsStore.getState().activateNewSessionDraft();
				return;
			}

			const meta = resolveWorkspaceSessions(
				[next],
				useSessionsStore.getState().sessions,
				useProjectsStore.getState().allSessions,
			)[0];

			if (meta) void useProjectsStore.getState().openSession(meta);
			else useSessionsStore.getState().activateNewSessionDraft();
		},
		[removeFromWorkspace],
	);
}
