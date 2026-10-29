import type { BrowserControlRequest } from "./browser-control";
import type {
	ExtensionDialogRequest,
	ExtensionDialogResolved,
	ExtensionEditorTextEvent,
	ExtensionNotifyEvent,
} from "./extension-dialog";
import type { CHANNEL_TABLE, InvokeApi } from "./ipc-channels";
import type { PluginNotify } from "./plugin-notify";
import type { PluginProfile } from "./plugin-profile";
import type { PtyDataEvent, PtyExitEvent } from "./pty";
import type { RemoteBrowserFrame, RemoteBrowserStatus } from "./remote-browser";
import type {
	PermissionRequest,
	PermissionResolved,
	SessionEventEnvelope,
	TrustRequest,
	UiState,
} from "./session";
import type { LoginEventPayload } from "./settings";
import type { UiPluginsEventPayload } from "./ui-plugins";
import type { WebAccessStatus } from "./web-access";

export {
	type AnyChannelDef,
	APP_CHANNELS,
	ARCHIVE_CHANNELS,
	BROWSER_CONTROL_CHANNELS,
	CHANNEL_TABLE,
	type ChannelCtor,
	type ChannelDef,
	ch,
	EXTENSION_DIALOG_CHANNELS,
	FS_CHANNELS,
	type InvokeApi,
	type InvokeHandlers,
	IpcChannels,
	PACKAGES_CHANNELS,
	PTY_CHANNELS,
	REMOTE_BROWSER_CHANNELS,
	SESSION_CHANNELS,
	SETTINGS_CHANNELS,
	UI_PLUGINS_CHANNELS,
	WEB_ACCESS_CHANNELS,
} from "./ipc-channels";

export interface PiApi extends InvokeApi<typeof CHANNEL_TABLE> {
	readonly platform: "darwin" | "win32" | "linux" | (string & {});

	getPathForFile(file: unknown): string;

	onProviderLoginEvent(cb: (payload: LoginEventPayload) => void): () => void;

	onUiPluginsEvent(cb: (payload: UiPluginsEventPayload) => void): () => void;

	onPtyData(cb: (payload: PtyDataEvent) => void): () => void;

	onRemoteBrowserFrame(cb: (frame: RemoteBrowserFrame) => void): () => void;

	onRemoteBrowserStatusChanged(
		cb: (payload: { id: string; status: RemoteBrowserStatus }) => void,
	): () => void;

	onWebAccessChanged(cb: (status: WebAccessStatus) => void): () => void;

	onPtyExit(cb: (payload: PtyExitEvent) => void): () => void;

	onQuitRequested(cb: () => void): () => void;

	onEvent(cb: (payload: SessionEventEnvelope) => void): () => void;

	onSessionsChanged(cb: () => void): () => void;

	onUiStateChanged(cb: (patch: Partial<UiState>) => void): () => void;
	onPermissionRequest(cb: (req: PermissionRequest) => void): () => void;
	onPermissionResolved(cb: (result: PermissionResolved) => void): () => void;

	onTrustRequest(cb: (req: TrustRequest) => void): () => void;

	onExtensionDialogRequest(cb: (req: ExtensionDialogRequest) => void): () => void;

	onExtensionDialogResolved(cb: (result: ExtensionDialogResolved) => void): () => void;

	onExtensionNotify(cb: (event: ExtensionNotifyEvent) => void): () => void;

	onExtensionEditorText(cb: (event: ExtensionEditorTextEvent) => void): () => void;

	onBrowserControlRequest(cb: (req: BrowserControlRequest) => void): () => void;

	onSidePaneOpenBrowserTab(cb: (payload: { url: string }) => void): () => void;
	onManagedConfigChanged(cb: () => void): () => void;
	onPluginNotify(cb: (n: PluginNotify) => void): () => void;
	onPluginProfile(cb: (p: PluginProfile) => void): () => void;

	onUpdateDownloadProgress(cb: (p: { received: number; total: number; percent: number }) => void): () => void;
}
