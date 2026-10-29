import type { PiBackend } from "@tcode/backend";
import { SESSION_CHANNELS } from "@tcode/shared";
import { registerInvokeHandlers } from "./invoke";

export function registerSessionsIpc(backend: PiBackend): void {
	registerInvokeHandlers(SESSION_CHANNELS, {
		createSession: ({ options }) => backend.createSession(options),
		listAllSessions: () => backend.listAllSessions(),
		openSession: ({ filePath }) => backend.openSession(filePath),
		closeSession: ({ sessionId, intent }) => backend.closeSession(sessionId, intent),
		getChannelSubscriptionSessionIds: () => backend.getChannelSubscriptionSessionIds(),
		deleteSession: ({ sessionId, sessionFile }) => backend.deleteSession(sessionId, sessionFile),
		prompt: ({ sessionId, text, images }) => backend.prompt(sessionId, text, images),
		abort: ({ sessionId }) => backend.abort(sessionId),
		setModel: ({ sessionId, provider, modelId }) => backend.setModel(sessionId, provider, modelId),
		setThinkingLevel: ({ sessionId, level }) => backend.setThinkingLevel(sessionId, level),
		getSessionMessages: ({ sessionId }) => backend.getSessionMessages(sessionId),
		getSubCallPage: ({ sessionId, toolCallId, offset, limit }) =>
			backend.getSubCallPage(sessionId, toolCallId, offset, limit),
		markSessionHistoryReady: ({ sessionId }) => backend.markSessionHistoryReady(sessionId),
		getTodos: ({ sessionId }) => backend.getTodos(sessionId),
		compact: ({ sessionId, customInstructions }) => backend.compact(sessionId, customInstructions),
		getStats: ({ sessionId }) => backend.getStats(sessionId),
		getContextUsage: ({ sessionId }) => backend.getContextUsage(sessionId),
		getQuota: () => backend.getQuota(),
		clearQueue: ({ sessionId }) => backend.clearQueue(sessionId),
		getFollowUpMessages: ({ sessionId }) => backend.getFollowUpMessages(sessionId),
		listSlashCommands: ({ sessionId }) => backend.listSlashCommands(sessionId),
		listSlashCommandsForCwd: ({ cwd }) => backend.listSlashCommandsForCwd(cwd),
		setSessionName: ({ sessionId, name }) => backend.setSessionName(sessionId, name),
		exportSession: ({ sessionId, format }) => backend.exportSession(sessionId, format),
		forkSession: ({ sessionId, ref }) => backend.forkSession(sessionId, ref),
		recallMessage: ({ sessionId, ref }) => backend.recallMessage(sessionId, ref),
		getLoadedResources: ({ sessionId }) => backend.getLoadedResources(sessionId),
		getLoadedResourcesForCwd: ({ cwd }) => backend.getLoadedResourcesForCwd(cwd),
		listModels: () => backend.listModels(),
		ensureProjectTrust: ({ cwd }) => backend.ensureProjectTrust(cwd),
	});
}
