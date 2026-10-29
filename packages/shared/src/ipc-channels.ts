import type { BrowserControlResult } from "./browser-control";
import type { ExtensionDialogRespond } from "./extension-dialog";
import type { FileReadRequest, FileReadResult } from "./fs";
import type { CatalogPackageType, CatalogSearchResult, ConfiguredPackageInfo } from "./packages";
import type { PtyCreateRequest } from "./pty";
import type { RemoteBrowserEmbedCheck, RemoteBrowserInputEvent, RemoteBrowserStatus } from "./remote-browser";
import type {
	AppInfo,
	ArchiveEntry,
	ArchiveResult,
	AvailableModel,
	ChannelWatchConfigInfo,
	Checkpoint,
	CheckpointWithDiff,
	ContextManagerConfigInfo,
	ContextManagerMode,
	ContextUsageInfo,
	CreateSessionOptions,
	GitBranches,
	ImageInput,
	LoadedResources,
	PermissionAnswer,
	PermissionConfigInfo,
	PermissionMode,
	QueuedMessages,
	QuotaInfo,
	SessionCloseIntent,
	SessionMessage,
	SessionMeta,
	SessionStats,
	SlashCommandInfo,
	TrustAnswer,
	UiState,
} from "./session";
import type {
	CustomProviderInput,
	CustomProviderUpdateInput,
	ListProvidersOptions,
	LoginResult,
	ModelPrefs,
	ProviderInfo,
	ProviderTestResult,
	SkillPrefs,
	SubagentInfo,
} from "./settings";
import type { TodoItem } from "./todo";
import type { UiPluginInfo, UiPluginManifest, UiPluginsConfig } from "./ui-plugins";
import type { WebAccessScope, WebAccessStatus } from "./web-access";

export interface ChannelDef<C extends string = string, A = void, R = unknown> {
	channel: C;
	args: A;
	ret: R;
}

export type ChannelCtor<C extends string> = <A, R>() => ChannelDef<C, A, R>;

export function ch<const C extends string>(channel: C): ChannelCtor<C> {
	const ctor = () => ({ channel });
	return ctor as ChannelCtor<C>;
}

export type AnyChannelDef = ChannelDef<string, any, any>;

export const SESSION_CHANNELS = {
	createSession: ch("session:create")<{ options: CreateSessionOptions }, SessionMeta>(),

	getQuota: ch("session:getQuota")<void, QuotaInfo | null>(),

	setModel: ch("session:setModel")<{ sessionId: string; provider: string; modelId: string }, string>(),

	listAllSessions: ch("session:listAll")<void, SessionMeta[]>(),
	openSession: ch("session:open")<{ filePath: string }, SessionMeta>(),

	closeSession: ch("session:close")<
		{ sessionId: string; intent?: SessionCloseIntent },
		{ closed: boolean }
	>(),

	deleteSession: ch("session:delete")<{ sessionId: string; sessionFile?: string }, void>(),

	prompt: ch("session:prompt")<{ sessionId: string; text: string; images?: ImageInput[] }, void>(),
	abort: ch("session:abort")<{ sessionId: string }, void>(),

	setThinkingLevel: ch("session:setThinkingLevel")<{ sessionId: string; level: string }, string>(),

	getSessionMessages: ch("session:getMessages")<{ sessionId: string }, SessionMessage[]>(),

	getSubCallPage: ch("session:getSubCallPage")<
		{ sessionId: string; toolCallId: string; offset: number; limit: number },
		{ rows: { id: string; name: string; args: string; output: string; isError: boolean }[]; total: number }
	>(),

	markSessionHistoryReady: ch("session:historyReady")<{ sessionId: string }, void>(),

	getTodos: ch("session:getTodos")<{ sessionId: string }, TodoItem[]>(),
	compact: ch("session:compact")<{ sessionId: string; customInstructions?: string }, void>(),
	getStats: ch("session:stats")<{ sessionId: string }, SessionStats>(),

	getContextUsage: ch("session:getContextUsage")<{ sessionId: string }, ContextUsageInfo | null>(),

	clearQueue: ch("session:clearQueue")<{ sessionId: string }, QueuedMessages>(),
	getFollowUpMessages: ch("session:getFollowUpMessages")<{ sessionId: string }, string[]>(),
	listSlashCommands: ch("session:listSlashCommands")<{ sessionId: string }, SlashCommandInfo[]>(),

	listSlashCommandsForCwd: ch("session:listSlashCommandsForCwd")<{ cwd?: string }, SlashCommandInfo[]>(),
	setSessionName: ch("session:setName")<{ sessionId: string; name: string }, void>(),
	exportSession: ch("session:export")<{ sessionId: string; format: "html" | "jsonl" }, string>(),

	forkSession: ch("session:fork")<
		{ sessionId: string; ref: { entryId?: string; text?: string } },
		SessionMeta
	>(),

	recallMessage: ch("session:recall")<
		{ sessionId: string; ref: { entryId?: string; text?: string; timestamp?: number } },
		{ text: string; images: ImageInput[] }
	>(),

	getLoadedResources: ch("session:getLoadedResources")<{ sessionId: string }, LoadedResources>(),

	getLoadedResourcesForCwd: ch("session:getLoadedResourcesForCwd")<{ cwd?: string }, LoadedResources>(),

	getChannelSubscriptionSessionIds: ch("session:getChannelSubscriptionSessionIds")<void, string[]>(),

	listModels: ch("models:list")<void, AvailableModel[]>(),

	ensureProjectTrust: ch("project:ensureTrust")<{ cwd: string }, boolean>(),
} as const;

export const ARCHIVE_CHANNELS = {
	listArchives: ch("archive:list")<void, ArchiveEntry[]>(),
	archiveSession: ch("archive:create")<
		{ sessionId: string; sessionFile: string; cwd: string; name?: string },
		ArchiveResult
	>(),
	restoreArchive: ch("archive:restore")<{ dir: string }, ArchiveResult>(),
	deleteArchive: ch("archive:delete")<{ dir: string }, { ok: true }>(),
} as const;

export const PACKAGES_CHANNELS = {
	searchCatalog: ch("packages:searchCatalog")<
		{ query: string; type?: CatalogPackageType | ""; page?: number },
		CatalogSearchResult
	>(),

	installPackage: ch("packages:install")<{ name: string }, void>(),

	removePackage: ch("packages:remove")<{ source: string; scope: "user" | "project" }, void>(),

	listConfiguredPackages: ch("packages:listConfigured")<void, ConfiguredPackageInfo[]>(),
} as const;

export const WEB_ACCESS_CHANNELS = {
	webAccessGetStatus: ch("webAccess:getStatus")<void, WebAccessStatus>(),

	webAccessSetEnabled: ch("webAccess:setEnabled")<{ enabled: boolean; port?: number }, WebAccessStatus>(),

	webAccessSetScope: ch("webAccess:setScope")<{ scope: WebAccessScope }, WebAccessStatus>(),

	webAccessRegenerateToken: ch("webAccess:regenerateToken")<void, WebAccessStatus>(),
} as const;

export const REMOTE_BROWSER_CHANNELS = {
	remoteBrowserCreate: ch("remoteBrowser:create")<
		{ url: string; width: number; height: number; scale?: number },
		{ id: string }
	>(),

	remoteBrowserResize: ch("remoteBrowser:resize")<
		{ id: string; width: number; height: number; scale?: number },
		void
	>(),

	remoteBrowserInput: ch("remoteBrowser:input")<{ id: string; event: RemoteBrowserInputEvent }, void>(),

	remoteBrowserStatus: ch("remoteBrowser:status")<{ id: string }, RemoteBrowserStatus>(),

	remoteBrowserEvaluate: ch("remoteBrowser:evaluate")<{ id: string; code: string }, unknown>(),

	remoteBrowserSetActive: ch("remoteBrowser:setActive")<{ id: string; active: boolean }, void>(),

	remoteBrowserDestroy: ch("remoteBrowser:destroy")<{ id: string }, void>(),

	remoteBrowserProbeEmbed: ch("remoteBrowser:probeEmbed")<{ url: string }, RemoteBrowserEmbedCheck>(),
} as const;

export const EXTENSION_DIALOG_CHANNELS = {
	respondExtensionDialog: ch("extension-dialog:respond")<
		{ requestId: string; answer: ExtensionDialogRespond },
		void
	>(),
} as const;

export const BROWSER_CONTROL_CHANNELS = {
	respondBrowserControl: ch("browserControl:respond")<{ id: string; result: BrowserControlResult }, void>(),

	invokeBrowserGuest: ch("browserControl:invoke")<
		{ webContentsId: number; method: string; params?: Record<string, unknown> },
		{ ok: true; result?: unknown } | { ok: false; error: string }
	>(),
} as const;

export const SETTINGS_CHANNELS = {
	listProviders: ch("settings:listProviders")<{ options?: ListProvidersOptions }, ProviderInfo[]>(),
	saveApiKey: ch("settings:saveApiKey")<{ providerId: string; key: string }, void>(),
	removeCredential: ch("settings:removeCredential")<{ providerId: string }, void>(),
	addCustomProvider: ch("settings:addCustomProvider")<{ input: CustomProviderInput }, void>(),

	updateCustomProvider: ch("settings:updateCustomProvider")<{ input: CustomProviderUpdateInput }, void>(),
	removeCustomProvider: ch("settings:removeCustomProvider")<{ providerId: string }, void>(),

	setProviderBaseUrl: ch("settings:setProviderBaseUrl")<
		{ providerId: string; baseUrl: string; apiKey?: string },
		void
	>(),
	testProvider: ch("settings:testProvider")<{ providerId: string; modelId?: string }, ProviderTestResult>(),

	getModelPrefs: ch("settings:getModelPrefs")<void, ModelPrefs>(),

	setModelHidden: ch("settings:setModelHidden")<
		{ provider: string; modelId: string; hidden: boolean },
		ModelPrefs
	>(),

	setModelsHidden: ch("settings:setModelsHidden")<
		{ provider: string; modelIds: string[]; hidden: boolean },
		ModelPrefs
	>(),

	setSubagentModel: ch("settings:setSubagentModel")<{ agent: string; modelRef: string | null }, ModelPrefs>(),

	setSubagentThinking: ch("settings:setSubagentThinking")<
		{ agent: string; level: string | null },
		ModelPrefs
	>(),

	setSubagentPreferBuiltin: ch("settings:setSubagentPreferBuiltin")<{ enabled: boolean }, ModelPrefs>(),

	setMainAgentPrompt: ch("settings:setMainAgentPrompt")<{ prompt: string | null }, ModelPrefs>(),

	setMainAgentName: ch("settings:setMainAgentName")<{ name: string | null }, ModelPrefs>(),

	getSkillPrefs: ch("settings:getSkillPrefs")<void, SkillPrefs>(),

	setSkillModelInvocationDisabled: ch("settings:setSkillModelInvocationDisabled")<
		{ name: string; disabled: boolean },
		SkillPrefs
	>(),

	createUserSkill: ch("settings:createUserSkill")<
		{ name: string; description: string; content?: string },
		string
	>(),

	readSkillFile: ch("settings:readSkillFile")<{ path: string }, string>(),

	deleteUserSkill: ch("settings:deleteUserSkill")<{ path: string }, void>(),

	listSubagents: ch("settings:listSubagents")<void, SubagentInfo[]>(),

	saveSubagent: ch("settings:saveSubagent")<
		{ name: string; originalName?: string; description: string; systemPrompt: string; tools: string[] },
		string
	>(),

	deleteSubagent: ch("settings:deleteSubagent")<{ name: string }, void>(),

	startProviderLogin: ch("settings:loginStart")<{ loginId: string; providerId: string }, LoginResult>(),

	cancelProviderLogin: ch("settings:loginCancel")<{ loginId: string }, void>(),

	respondProviderLogin: ch("settings:loginRespond")<
		{ loginId: string; promptId: string; value: string },
		void
	>(),

	respondPermission: ch("permission:respond")<{ requestId: string; answer: PermissionAnswer }, void>(),

	getPermissionConfig: ch("permission:getConfig")<void, PermissionConfigInfo>(),

	getPermissionMode: ch("permission:getMode")<{ sessionId: string }, PermissionMode>(),

	setPermissionMode: ch("permission:setMode")<{ sessionId: string; mode: PermissionMode }, void>(),

	getContextManagerConfig: ch("contextManager:getConfig")<void, ContextManagerConfigInfo>(),
	setContextManagerMode: ch("contextManager:setMode")<{ mode: ContextManagerMode }, void>(),

	getChannelWatchConfig: ch("channelWatch:getConfig")<void, ChannelWatchConfigInfo>(),
	setChannelWatchEnabled: ch("channelWatch:setEnabled")<{ enabled: boolean }, void>(),

	respondTrust: ch("trust:respond")<{ requestId: string; answer: TrustAnswer }, void>(),
} as const;

export const APP_CHANNELS = {
	saveFileDialog: ch("file:saveDialog")<{ defaultName: string; content: string }, string | null>(),

	pickDirectory: ch("project:pickDirectory")<void, string | null>(),
	listGitBranches: ch("project:listGitBranches")<{ cwd: string }, GitBranches>(),

	checkpointCreate: ch("checkpoint:create")<
		{ sessionId: string; cwd: string; message: string; allowEmpty?: boolean; since?: number },
		Checkpoint | null
	>(),

	checkpointList: ch("checkpoint:list")<{ sessionId: string; cwd: string }, Checkpoint[]>(),

	checkpointMarkTurnStart: ch("checkpoint:markTurnStart")<{ sessionId: string; cwd: string }, void>(),

	checkpointListWithDiff: ch("checkpoint:listWithDiff")<
		{ sessionId: string; cwd: string },
		CheckpointWithDiff[]
	>(),

	checkpointRestore: ch("checkpoint:restore")<
		{ sessionId: string; cwd: string; sha: string },
		{ changed: boolean; files: string[] }
	>(),

	checkoutBranch: ch("project:checkoutBranch")<{ cwd: string; branch: string }, string>(),

	openExternal: ch("app:openExternal")<{ url: string }, void>(),

	resolvePath: ch("app:resolvePath")<{ target: string; cwd: string | null }, string>(),

	openPath: ch("app:openPath")<{ target: string; cwd: string | null }, void>(),

	revealPath: ch("app:revealPath")<{ target: string; cwd: string | null }, void>(),

	getAppInfo: ch("app:getInfo")<void, AppInfo>(),

	getDailyDir: ch("app:getDailyDir")<void, string>(),

	loadUiState: ch("uiState:load")<void, UiState | null>(),

	loadSessionPermissionMode: ch("uiState:loadPermissionMode")<{ sessionId: string }, PermissionMode | null>(),

	saveUiState: ch("uiState:save")<{ state: Partial<UiState> }, void>(),

	setUiLanguage: ch("uiState:setLanguage")<{ language: "zh" | "en"; chatLanguage?: "zh" | "en" }, void>(),

	pickBackgroundImage: ch("background:pick")<void, string | null>(),

	setQuitGuard: ch("app:setQuitGuard")<{ enabled: boolean }, void>(),

	quitDialogShown: ch("app:quitDialogShown")<void, void>(),

	confirmQuit: ch("app:confirmQuit")<void, void>(),
} as const;

export const UI_PLUGINS_CHANNELS = {
	uiPluginsGetConfig: ch("uiPlugins:getConfig")<void, UiPluginsConfig>(),

	uiPluginsSetEnabled: ch("uiPlugins:setEnabled")<{ enabled: boolean }, void>(),

	uiPluginsList: ch("uiPlugins:list")<void, UiPluginInfo[]>(),

	uiPluginsReadCode: ch("uiPlugins:readCode")<
		{ name: string },
		{ manifest: UiPluginManifest; code: string } | { error: string }
	>(),

	uiPluginsSetPluginEnabled: ch("uiPlugins:setPluginEnabled")<{ name: string; enabled: boolean }, void>(),

	uiPluginsAssignSlot: ch("uiPlugins:assignSlot")<{ slot: string; pluginName: string | null }, void>(),

	uiPluginsRebuild: ch("uiPlugins:rebuild")<{ name: string }, { ok: true } | { ok: false; error: string }>(),

	uiPluginsOpenDir: ch("uiPlugins:openDir")<{ name?: string }, void>(),
} as const;

export const FS_CHANNELS = {
	readWorkspaceFile: ch("fs:readFile")<FileReadRequest, FileReadResult>(),
} as const;

export const PTY_CHANNELS = {
	ptyCreate: ch("pty:create")<PtyCreateRequest, { id: string }>(),

	ptyWrite: ch("pty:write")<{ id: string; data: string }, void>(),

	ptyResize: ch("pty:resize")<{ id: string; cols: number; rows: number }, void>(),

	ptyKill: ch("pty:kill")<{ id: string }, void>(),
} as const;

export const PLUGIN_NOTIFY_CHANNELS = {
	pluginNotifyGet: ch("pluginNotify:get")<void, import("./plugin-notify").PluginNotify[]>(),
} as const;

export const PLUGIN_PROFILE_CHANNELS = {
	pluginProfileGet: ch("pluginProfile:get")<void, import("./plugin-profile").PluginProfile | null>(),
} as const;

export const COMPONENT_LICENSES_CHANNELS = {
	componentLicensesGet: ch("componentLicenses:get")<
		void,
		import("./component-licenses").ComponentLicense[]
	>(),
} as const;

export const PLUGIN_COMMAND_CHANNELS = {
	pluginCommand: ch("pluginCommand:send")<{ cmd: string }, void>(),
} as const;

export const UPDATE_CHANNELS = {
	updateDownload: ch("update:download")<{ url: string }, { ok: boolean; error?: string }>(),
	updateInstall: ch("update:install")<void, { ok: boolean; error?: string }>(),
} as const;

export const CHANNEL_TABLE = {
	...SESSION_CHANNELS,
	...ARCHIVE_CHANNELS,
	...SETTINGS_CHANNELS,
	...PACKAGES_CHANNELS,
	...APP_CHANNELS,
	...WEB_ACCESS_CHANNELS,
	...REMOTE_BROWSER_CHANNELS,
	...EXTENSION_DIALOG_CHANNELS,
	...BROWSER_CONTROL_CHANNELS,
	...UI_PLUGINS_CHANNELS,
	...FS_CHANNELS,
	...PTY_CHANNELS,
	...PLUGIN_NOTIFY_CHANNELS,
	...PLUGIN_PROFILE_CHANNELS,
	...PLUGIN_COMMAND_CHANNELS,
	...COMPONENT_LICENSES_CHANNELS,
	...UPDATE_CHANNELS,
} as const;

export type InvokeApi<T extends Record<string, AnyChannelDef>> = {
	[K in keyof T]: T[K]["args"] extends void
		? () => Promise<T[K]["ret"]>
		: (args: T[K]["args"]) => Promise<T[K]["ret"]>;
};

export type InvokeHandlers<T extends Record<string, AnyChannelDef>> = {
	[K in keyof T]: T[K]["args"] extends void
		? () => T[K]["ret"] | Promise<T[K]["ret"]>
		: (args: T[K]["args"]) => T[K]["ret"] | Promise<T[K]["ret"]>;
};

function channelsFromTable<T extends Record<string, AnyChannelDef>>(
	table: T,
): { [K in keyof T]: T[K]["channel"] } {
	return Object.fromEntries(Object.entries(table).map(([key, def]) => [key, def.channel])) as {
		[K in keyof T]: T[K]["channel"];
	};
}

const EVENT_CHANNELS = {
	Event: "pi:event",

	SessionsChanged: "pi:sessions-changed",

	UiStateChanged: "uiState:changed",
	PermissionRequest: "pi:permission-request",

	PermissionResolved: "pi:permission-resolved",

	TrustRequest: "pi:trust-request",

	ExtensionDialogRequest: "pi:extension-dialog-request",
	ExtensionDialogResolved: "pi:extension-dialog-resolved",
	ExtensionNotify: "pi:extension-notify",
	ExtensionEditorText: "pi:extension-editor-text",

	SettingsLoginEvent: "settings:loginEvent",

	UiPluginsEvent: "uiPlugins:event",

	PtyData: "pty:data",

	PtyExit: "pty:exit",

	QuitRequested: "app:quit-requested",

	RemoteBrowserFrame: "remoteBrowser:frame",

	RemoteBrowserStatusChanged: "remoteBrowser:statusChanged",

	WebAccessChanged: "webAccess:changed",

	BrowserControlRequest: "browserControl:request",

	SidePaneOpenBrowserTab: "sidepane:openBrowserTab",
	ManagedConfigChanged: "managedConfig:changed",
	PluginNotify: "pluginNotify:event",
	PluginProfileChanged: "pluginProfile:changed",
	UpdateDownloadProgress: "update:downloadProgress",
} as const;

export const IpcChannels = Object.freeze({
	...EVENT_CHANNELS,
	...channelsFromTable(CHANNEL_TABLE),
});
