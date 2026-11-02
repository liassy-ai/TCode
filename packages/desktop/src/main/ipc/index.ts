import type { PiBackend } from "@tcode/backend";
import { IpcChannels } from "@tcode/shared";
import { app, BrowserWindow } from "electron";
import { PtyManager } from "../pty";
import { attachRemoteBrowserCleanup, RemoteBrowserManager } from "../remote-browser";
import {
	cwdDisplayName,
	notifySessionEvent,
	notifyTask,
	rememberSessionName,
	rememberSessionNames,
	sessionDisplayName,
	setTaskNotifyOpenHandler,
} from "../task-notify";
import type { UiPluginManager } from "../ui-plugins/manager";
import type { WebBridgeService } from "../web-bridge";
import { broadcastBridgeEvent, hasBridgeClients } from "../web-bridge";
import { registerAppIpc } from "./app";
import { registerArchiveIpc } from "./archive";
import { registerBrowserControlIpc } from "./browser-control";
import { registerDraftIpc } from "./draft";
import { registerExtensionDialogIpc } from "./extension-dialogs";
import { registerFsIpc } from "./fs";
import { registerMcpIpc } from "./mcp";
import { registerPackagesIpc } from "./packages";
import { registerPtyIpc } from "./pty";
import { registerRemoteBrowserIpc } from "./remote-browser";
import { registerSessionsIpc } from "./sessions";
import { registerSettingsIpc } from "./settings";
import { registerUiPluginsIpc } from "./ui-plugins";
import { registerWebAccessIpc } from "./web-access";

export function sendToRenderer(channel: string, payload: unknown): void {
	if (channel !== IpcChannels.RemoteBrowserFrame) {
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) window.webContents.send(channel, payload);
		}
	}
	broadcastBridgeEvent(channel, payload);
}

function forward<T>(subscribe: (handler: (payload: T) => void) => void, channel: string): void {
	subscribe((payload) => sendToRenderer(channel, payload));
}

export function registerIpc(
	backend: PiBackend,
	uiPluginsManager: UiPluginManager,
	webBridge: WebBridgeService,
): void {
	registerSessionsIpc(backend);
	registerArchiveIpc();
	registerSettingsIpc(backend);
	registerDraftIpc(backend);
	registerMcpIpc(backend, sendToRenderer);
	registerPackagesIpc(backend);
	registerAppIpc(backend);

	registerFsIpc(backend);

	const ptyManager = new PtyManager((channel, payload) => sendToRenderer(channel, payload));
	registerPtyIpc(backend, ptyManager);

	app.on("before-quit", () => {
		ptyManager.killAll();
	});
	registerExtensionDialogIpc(backend);

	registerBrowserControlIpc();
	registerUiPluginsIpc(uiPluginsManager);

	registerWebAccessIpc(webBridge);

	const remoteBrowser = new RemoteBrowserManager(
		(channel, payload) => sendToRenderer(channel, payload),
		hasBridgeClients,
	);
	registerRemoteBrowserIpc(remoteBrowser);
	attachRemoteBrowserCleanup(remoteBrowser);

	uiPluginsManager.startWatcher((name) => {
		sendToRenderer(IpcChannels.UiPluginsEvent, { kind: "changed", name });
	});

	void backend
		.listAllSessions()
		.then((sessions) => rememberSessionNames(sessions.map((s) => ({ sessionId: s.sessionId, name: s.name }))))
		.catch(() => {});

	backend.onEvent((sessionId, event) => {
		sendToRenderer(IpcChannels.Event, { sessionId, event });
		if (event.type === "session_info_changed" && event.name) rememberSessionName(sessionId, event.name);
		notifySessionEvent(sessionId, event);
	});

	setTaskNotifyOpenHandler((payload) => sendToRenderer(IpcChannels.NotificationOpen, payload));

	backend.onSessionsChanged(() => {
		sendToRenderer(IpcChannels.SessionsChanged, undefined);
	});

	forward(backend.onPermissionRequest.bind(backend), IpcChannels.PermissionRequest);
	backend.onPermissionRequest((request) => {
		notifyTask({
			kind: "attention",
			sessionId: request.sessionId,
			sessionName: sessionDisplayName(request.sessionId),
			detail: request.title || request.message,
		});
	});

	forward(backend.onPermissionResolved.bind(backend), IpcChannels.PermissionResolved);
	forward(backend.onTrustRequest.bind(backend), IpcChannels.TrustRequest);
	backend.onTrustRequest((request) => {
		notifyTask({
			kind: "attention",
			sessionId: request.cwd,
			sessionName: cwdDisplayName(request.cwd),
			detail: "需要在项目里执行命令，请确认是否信任",
		});
	});

	forward(backend.onExtensionDialogRequest.bind(backend), IpcChannels.ExtensionDialogRequest);
	backend.onExtensionDialogRequest((request) => {
		notifyTask({
			kind: "attention",
			sessionId: request.sessionId,
			sessionName: sessionDisplayName(request.sessionId),
			detail: request.title || request.message,
		});
	});
	forward(backend.onExtensionDialogResolved.bind(backend), IpcChannels.ExtensionDialogResolved);
	forward(backend.onExtensionNotify.bind(backend), IpcChannels.ExtensionNotify);
	forward(backend.onExtensionEditorText.bind(backend), IpcChannels.ExtensionEditorText);
	forward(backend.onLoginEvent.bind(backend), IpcChannels.SettingsLoginEvent);
}
