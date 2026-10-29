import { writeFile } from "node:fs/promises";
import type { PiBackend } from "@tcode/backend";
import { APP_CHANNELS, IpcChannels } from "@tcode/shared";
import { app, BrowserWindow, dialog, nativeTheme, shell } from "electron";
import { pickBackgroundImage } from "../background";
import {
	createSnapshot,
	listSnapshots,
	listSnapshotsWithDiff,
	markTurnStart,
	restoreSnapshot,
} from "../checkpoints";
import { ensureDailyDir } from "../daily";
import { checkoutBranch, listGitBranches } from "../git";
import { resolveExistingPath } from "../path-target";
import { loadUiState, saveUiState } from "../ui-state";
import { ackQuitDialog, setQuitGuard } from "../window";
import { sendToRenderer } from "./index";
import { registerInvokeHandlers } from "./invoke";

export function registerAppIpc(backend: PiBackend): void {
	registerInvokeHandlers(APP_CHANNELS, {
		saveFileDialog: async ({ defaultName, content }) => {
			const window = BrowserWindow.getAllWindows()[0];
			const options: Electron.SaveDialogOptions = {
				defaultPath: defaultName,
				filters: [{ name: "All Files", extensions: ["*"] }],
			};
			const result = window
				? await dialog.showSaveDialog(window, options)
				: await dialog.showSaveDialog(options);
			if (result.canceled || !result.filePath) return null;
			await writeFile(result.filePath, content, "utf-8");
			return result.filePath;
		},
		pickDirectory: async () => {
			const window = BrowserWindow.getAllWindows()[0];
			const options: Electron.OpenDialogOptions = { properties: ["openDirectory", "createDirectory"] };
			const result = window
				? await dialog.showOpenDialog(window, options)
				: await dialog.showOpenDialog(options);
			return result.canceled ? null : (result.filePaths[0] ?? null);
		},
		listGitBranches: ({ cwd }) => listGitBranches(cwd),
		checkpointCreate: ({ sessionId, cwd, message, allowEmpty, since }) =>
			createSnapshot(sessionId, cwd, message, { allowEmpty, since }),
		checkpointList: ({ sessionId, cwd }) => listSnapshots(sessionId, cwd),
		checkpointListWithDiff: ({ sessionId, cwd }) => listSnapshotsWithDiff(sessionId, cwd),
		checkpointRestore: ({ sessionId, cwd, sha }) => restoreSnapshot(sessionId, cwd, sha),
		checkpointMarkTurnStart: ({ sessionId, cwd }) => markTurnStart(sessionId, cwd),
		checkoutBranch: ({ cwd, branch }) => checkoutBranch(cwd, branch),
		openExternal: ({ url }) => {
			if (typeof url === "string" && /^https?:\/\//.test(url)) return shell.openExternal(url);
		},

		resolvePath: ({ target, cwd }) => resolveExistingPath(target, cwd),
		openPath: async ({ target, cwd }) => {
			const error = await shell.openPath(resolveExistingPath(target, cwd));
			if (error) throw new Error(error);
		},
		revealPath: ({ target, cwd }) => {
			shell.showItemInFolder(resolveExistingPath(target, cwd));
		},
		getAppInfo: () => ({
			name: app.getName(),
			version: app.getVersion(),
			electron: process.versions.electron ?? "",
			chrome: process.versions.chrome ?? "",
			node: process.versions.node ?? "",
			platform: process.platform,
			arch: process.arch,
		}),

		getDailyDir: () => ensureDailyDir(),
		loadUiState: () => loadUiState(),
		loadSessionPermissionMode: async ({ sessionId }) =>
			(await loadUiState())?.sessionPermissionModes?.[sessionId] ?? null,
		saveUiState: async ({ state }) => {
			if (state.theme) nativeTheme.themeSource = state.theme;
			await saveUiState(state);

			sendToRenderer(IpcChannels.UiStateChanged, state);
		},

		setUiLanguage: ({ language, chatLanguage }) => {
			backend.setUiLanguage(language, chatLanguage);
		},
		pickBackgroundImage: () => pickBackgroundImage(BrowserWindow.getAllWindows()[0]),

		setQuitGuard: ({ enabled }) => setQuitGuard(enabled),
		quitDialogShown: () => ackQuitDialog(),
		confirmQuit: () => {
			app.quit();
		},
	});
}
