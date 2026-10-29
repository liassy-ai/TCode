import { join } from "node:path";
import { IpcChannels, type ThemeMode } from "@tcode/shared";
import { app, BrowserWindow, nativeTheme, shell } from "electron";

const __dirname = import.meta.dirname;

const QUIT_ACK_TIMEOUT_MS = 1500;

const ZOOM_KEYS = new Set(["+", "-", "=", "_", "0"]);

let quitting = false;

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
	if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
	return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed()) ?? null;
}

let quitGuard = false;

let quitAckTimer: NodeJS.Timeout | undefined;

export function markQuitting(): void {
	quitting = true;
	ackQuitDialog();
}

export function setQuitGuard(enabled: boolean): void {
	quitGuard = enabled;
}

export function ackQuitDialog(): void {
	if (!quitAckTimer) return;
	clearTimeout(quitAckTimer);
	quitAckTimer = undefined;
}

function windowBackground(theme: "dark" | "light"): string {
	return theme === "dark" ? "#17171a" : "#fafafa";
}

export function resolveTheme(theme: ThemeMode | undefined): "dark" | "light" {
	return theme === "dark" || (theme !== "light" && nativeTheme.shouldUseDarkColors) ? "dark" : "light";
}

function titleBarOverlay(theme: "dark" | "light"): Electron.TitleBarOverlay {
	return {
		color: windowBackground(theme),
		symbolColor: theme === "dark" ? "#fafafa" : "#17171a",
		height: 48,
	};
}

export function applyChromeTheme(mode: ThemeMode): void {
	const resolved = resolveTheme(mode);
	for (const win of BrowserWindow.getAllWindows()) {
		win.setBackgroundColor(windowBackground(resolved));
		if (process.platform === "win32") win.setTitleBarOverlay(titleBarOverlay(resolved));
	}
}

export function createWindow(theme: "dark" | "light" = "light"): BrowserWindow {
	const window = new BrowserWindow({
		width: 1100,
		height: 750,
		minWidth: 640,
		minHeight: 480,
		show: false,

		...(process.platform === "darwin"
			? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 16, y: 16 } }
			: {}),
		...(process.platform === "win32"
			? { titleBarStyle: "hidden" as const, titleBarOverlay: titleBarOverlay(theme) }
			: {}),
		backgroundColor: windowBackground(theme),
		webPreferences: {
			preload: join(__dirname, "../preload/index.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,

			webviewTag: true,

			backgroundThrottling: false,
		},
	});

	window.on("ready-to-show", () => window.show());
	mainWindow = window;

	void window.webContents.setVisualZoomLevelLimits(1, 1);

	window.webContents.on("before-input-event", (event, input) => {
		if (input.type === "keyDown" && (input.control || input.meta) && ZOOM_KEYS.has(input.key)) {
			event.preventDefault();
		}
	});

	window.webContents.on("did-finish-load", () => {
		if (window.webContents.getZoomFactor() !== 1) window.webContents.setZoomFactor(1);
	});

	window.webContents.on("did-start-loading", () => {
		quitGuard = false;
	});

	window.on("close", (event) => {
		if (quitting) return;
		if (process.platform === "darwin") {
			event.preventDefault();
			window.hide();
			return;
		}
		if (process.platform !== "win32") return;
		if (!quitGuard || window.webContents.isDestroyed()) return;
		event.preventDefault();
		window.webContents.send(IpcChannels.QuitRequested);

		ackQuitDialog();
		quitAckTimer = setTimeout(() => {
			quitAckTimer = undefined;
			quitting = true;
			app.quit();
		}, QUIT_ACK_TIMEOUT_MS);
	});

	window.webContents.on("will-navigate", (event) => event.preventDefault());
	window.webContents.setWindowOpenHandler((details) => {
		if (/^https?:\/\//i.test(details.url)) void shell.openExternal(details.url);
		return { action: "deny" };
	});

	if (process.env.ELECTRON_RENDERER_URL) {
		const url = new URL(process.env.ELECTRON_RENDERER_URL);

		if (url.hostname === "localhost") url.hostname = "127.0.0.1";
		url.searchParams.set("theme", theme);
		void window.loadURL(url.toString());
	} else {
		void window.loadFile(join(__dirname, "../renderer/index.html"), { search: `theme=${theme}` });
	}

	return window;
}
