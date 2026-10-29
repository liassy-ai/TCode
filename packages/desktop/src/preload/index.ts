import {
	type BrowserControlRequest,
	CHANNEL_TABLE,
	type ExtensionDialogRequest,
	type ExtensionDialogResolved,
	type ExtensionEditorTextEvent,
	type ExtensionNotifyEvent,
	type InvokeApi,
	IpcChannels,
	type LoginEventPayload,
	type PermissionRequest,
	type PermissionResolved,
	type PiApi,
	type PluginNotify,
	type PluginProfile,
	type PtyDataEvent,
	type PtyExitEvent,
	type RemoteBrowserFrame,
	type RemoteBrowserStatus,
	type SessionEventEnvelope,
	type TrustRequest,
	type UiPluginsEventPayload,
	type UiState,
	type WebAccessStatus,
} from "@tcode/shared";
import { contextBridge, ipcRenderer, webUtils } from "electron";

function makeSubscription<T>(channel: string): (cb: (payload: T) => void) => () => void {
	return (cb) => {
		const listener = (_event: unknown, payload: T) => cb(payload);
		ipcRenderer.on(channel, listener);
		return () => ipcRenderer.removeListener(channel, listener);
	};
}

const invokeApi = Object.fromEntries(
	Object.entries(CHANNEL_TABLE).map(([key, def]) => [
		key,
		(args: unknown) => ipcRenderer.invoke(def.channel, args),
	]),
) as InvokeApi<typeof CHANNEL_TABLE>;

const api: PiApi = {
	platform: process.platform,
	getPathForFile: (file) => webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0]),
	...invokeApi,
	onProviderLoginEvent: makeSubscription<LoginEventPayload>(IpcChannels.SettingsLoginEvent),
	onUiPluginsEvent: makeSubscription<UiPluginsEventPayload>(IpcChannels.UiPluginsEvent),
	onQuitRequested: makeSubscription<void>(IpcChannels.QuitRequested),
	onEvent: makeSubscription<SessionEventEnvelope>(IpcChannels.Event),
	onSessionsChanged: makeSubscription<void>(IpcChannels.SessionsChanged),
	onUiStateChanged: makeSubscription<Partial<UiState>>(IpcChannels.UiStateChanged),
	onBrowserControlRequest: makeSubscription<BrowserControlRequest>(IpcChannels.BrowserControlRequest),
	onPermissionRequest: makeSubscription<PermissionRequest>(IpcChannels.PermissionRequest),
	onPermissionResolved: makeSubscription<PermissionResolved>(IpcChannels.PermissionResolved),
	onTrustRequest: makeSubscription<TrustRequest>(IpcChannels.TrustRequest),
	onExtensionDialogRequest: makeSubscription<ExtensionDialogRequest>(IpcChannels.ExtensionDialogRequest),
	onExtensionDialogResolved: makeSubscription<ExtensionDialogResolved>(IpcChannels.ExtensionDialogResolved),
	onExtensionNotify: makeSubscription<ExtensionNotifyEvent>(IpcChannels.ExtensionNotify),
	onExtensionEditorText: makeSubscription<ExtensionEditorTextEvent>(IpcChannels.ExtensionEditorText),
	onRemoteBrowserFrame: makeSubscription<RemoteBrowserFrame>(IpcChannels.RemoteBrowserFrame),
	onRemoteBrowserStatusChanged: makeSubscription<{ id: string; status: RemoteBrowserStatus }>(
		IpcChannels.RemoteBrowserStatusChanged,
	),
	onWebAccessChanged: makeSubscription<WebAccessStatus>(IpcChannels.WebAccessChanged),
	onPtyData: makeSubscription<PtyDataEvent>(IpcChannels.PtyData),
	onPtyExit: makeSubscription<PtyExitEvent>(IpcChannels.PtyExit),
	onSidePaneOpenBrowserTab: makeSubscription<{ url: string }>(IpcChannels.SidePaneOpenBrowserTab),
	onManagedConfigChanged: makeSubscription<void>(IpcChannels.ManagedConfigChanged),
	onPluginNotify: makeSubscription<PluginNotify>(IpcChannels.PluginNotify),
	onPluginProfile: makeSubscription<PluginProfile>(IpcChannels.PluginProfileChanged),
	onUpdateDownloadProgress: makeSubscription<{ received: number; total: number; percent: number }>(
		IpcChannels.UpdateDownloadProgress,
	),
};

contextBridge.exposeInMainWorld("pi", api);
