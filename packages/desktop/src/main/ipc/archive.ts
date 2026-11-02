import { ARCHIVE_CHANNELS } from "@tcode/shared";
import {
	archiveSession,
	cleanupExpiredArchives,
	deleteArchive,
	listArchives,
	restoreArchive,
} from "../archive";
import { registerInvokeHandlers } from "./invoke";

export function registerArchiveIpc(): void {
	void cleanupExpiredArchives();
	registerInvokeHandlers(ARCHIVE_CHANNELS, {
		listArchives: () => listArchives(),
		archiveSession: ({ sessionId, sessionFile, cwd, name }) =>
			archiveSession({ sessionId, sessionFile, cwd, name }),
		restoreArchive: ({ dir }) => restoreArchive(dir),
		deleteArchive: async ({ dir }) => {
			await deleteArchive(dir);
			return { ok: true as const };
		},
	});
}
