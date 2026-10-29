import type { AgentSessionEvent as PiAgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { SidePaneSnapshot } from "./sidepane";
import type { SkillInvocationDisplay } from "./skill-invocation";
import type { SubagentRunData } from "./subagent";

export interface SessionWorkspaceSnapshot {
	files: string[];

	activeFile: string | null;
}

export type ThemeMode = "light" | "dark" | "system";

export interface BackgroundSettings {
	image: string | null;
	dim: number;
}

export interface UiState {
	lastUsedModel: { provider: string; modelId: string } | null;

	lastUsedThinkingLevel: string;
	theme: ThemeMode;
	background: BackgroundSettings;

	centerOrbEnabled: boolean;

	browserControl: boolean;

	pinnedSessions: string[];

	sessionPermissionModes: Record<string, PermissionMode>;

	barSessionsVisible: boolean;

	sessionRailEnabled: boolean;

	sessionWorkspace: SessionWorkspaceSnapshot;

	sidebarCollapsed: boolean;

	expandedGroups: string[];

	expandedGroupsTouched: boolean;

	pinnedProjects: string[];

	lastCwd: string | null;

	sidePane: SidePaneSnapshot;
}

export interface SessionModelRef {
	provider: string;
	modelId: string;
}

export interface SessionMeta {
	sessionId: string;

	sessionFile?: string;
	cwd: string;

	name?: string;
	modelLabel?: string;

	model?: SessionModelRef | null;

	thinkingLevel?: string | null;

	active: boolean;

	readOnly?: boolean;

	messageCount: number;

	createdAt: number;

	modifiedAt?: number;
}

export interface SessionModelUsage {
	model: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;

	cost: number;
}

export interface SessionStats {
	inputTokens: number;
	outputTokens: number;

	cacheReadTokens: number;

	cacheWriteTokens: number;

	cost: number;

	byModel: SessionModelUsage[];
}

export interface SessionToolCall {
	id: string;
	name: string;

	args: string;

	output: string;

	diff?: string;

	endedAt?: number;
	isError: boolean;

	subCallTotal?: number;
}

export const SUB_CALL_MATERIALIZE = 50;

interface SessionBaseMessage {
	text: string;
	thinking: string;
	tools: SessionToolCall[];

	images: ImageInput[];
	timestamp: number;

	entryId?: string;

	sourceText?: string;
}

export interface SessionUserMessage extends SessionBaseMessage {
	role: "user";

	skill?: SkillInvocationDisplay;
}

export interface SessionAssistantMessage extends SessionBaseMessage {
	role: "assistant";

	stopReason?: string;

	errorMessage?: string;
}

export interface SessionImageMessage {
	role: "image";
	images: ImageInput[];

	paths: string[];
	timestamp: number;
}

export interface SessionSubagentMessage {
	role: "subagent";
	runs: SubagentRunData[];
	timestamp: number;
}

export interface SessionCompactionMessage {
	role: "compaction";
	timestamp: number;

	summary?: string;

	tokensBefore?: number;
}

export interface SessionAgentMessage {
	role: "agent";

	agent: string;
	text: string;
	timestamp: number;

	sessionFile?: string;
}

export const AGENT_MESSAGE_CUSTOM_TYPE = "agent-message";

export type SessionMessage =
	| SessionUserMessage
	| SessionAssistantMessage
	| SessionImageMessage
	| SessionSubagentMessage
	| SessionCompactionMessage
	| SessionAgentMessage;

export interface AvailableModel {
	provider: string;

	providerName: string;
	id: string;

	label: string;

	authed: boolean;

	thinkingLevels?: string[];

	imageInput?: boolean;
}

export interface ImageInput {
	data: string;
	mimeType: string;
}

export type SlashCommandSource = "builtin" | "template" | "skill" | "extension";

export interface SlashCommandInfo {
	name: string;
	description: string;
	argumentHint?: string;
	source: SlashCommandSource;

	supported: boolean;
}

export interface ContextUsageInfo {
	tokens: number | null;

	contextWindow: number;

	percent: number | null;
}

export type QuotaWindowKey = "rolling" | "weekly" | "monthly";

export interface QuotaWindow {
	key: QuotaWindowKey;

	label: string;

	percent: number;

	resetsAt: string | null;

	usedUsd: number | null;

	limitUsd: number;
	status: "ok" | "rate-limited";
}

export interface QuotaInfo {
	windows: QuotaWindow[];
	updatedAt: number;
	error?: string;
}

export interface QueuedMessages {
	steering: string[];
	followUp: string[];
}

export interface CreateSessionOptions {
	cwd: string;
	provider?: string;
	modelId?: string;
	thinkingLevel?: string;
}

export type PermissionRequestKind = "path" | "command" | "other";

export interface PermissionRequest {
	id: string;
	sessionId: string;
	title: string;
	message: string;
	kind: PermissionRequestKind;

	suggestDir?: string;
}

export type PermissionAnswer = "allow" | "deny" | "allowAlways" | "allowDir";

export interface PermissionResolved {
	sessionId: string;
	requestId: string;
	answered: boolean;
}

export interface PermissionConfigInfo {
	enabled: boolean;
}

export type PermissionMode = "default" | "viewOnly" | "fullAccess";

export type SessionCloseIntent = "user" | "gc";

export type ContextManagerMode = "evaporation" | "off";

export interface ContextManagerConfigInfo {
	mode: ContextManagerMode;
}

export interface ChannelWatchConfigInfo {
	enabled: boolean;
}

export interface TrustOption {
	key: "trust" | "deny";
}

export interface TrustRequest {
	id: string;
	cwd: string;
	options: TrustOption[];
}

export type TrustAnswer = number;

export interface GitBranches {
	current: string | null;
	branches: string[];

	gitMissing?: boolean;
}

export interface CheckpointWithDiff extends Checkpoint {
	files: GitWorkspaceFile[];
}

export interface GitWorkspaceFile {
	path: string;
	added: number;
	removed: number;

	untracked: boolean;

	patch: string;
}

export interface Checkpoint {
	sha: string;
	message: string;
	time: string;

	turn?: number;
}

export interface ArchiveMeta {
	sessionId: string;

	sessionFile: string;
	cwd: string;

	project: string;
	name?: string;
	archivedAt: number;
	sizeBytes: number;
}

export interface ArchiveEntry extends ArchiveMeta {
	dir: string;
}

export interface ArchiveResult {
	ok: boolean;

	reason?: "no-target" | "conflict";
	dir?: string;
}

export interface AppInfo {
	name: string;

	version: string;
	electron: string;
	chrome: string;
	node: string;
	platform: string;
	arch: string;
}

export type ResourceScope = "user" | "project" | "temporary";

export type SkillTier = "core" | "system" | "user";

export const SHIPPED_SKILL_TIERS: Readonly<Record<string, "core" | "system">> = {
	"tcode-desktop": "core",
	"tcode-browser": "core",
	"tcode-reply-language": "core",
	"tcode-subagent-explore": "core",
	"tcode-ai-title-en": "core",
	"tcode-ai-title-zh": "core",
	"web-annotate": "core",

	"tcode-ui-plugin": "system",
	"channel-pickup": "system",
	"design-handoff": "system",
};

export function skillTierOf(name: string, shipped?: boolean): SkillTier {
	return SHIPPED_SKILL_TIERS[name] ?? (shipped ? "system" : "user");
}

const SKILL_DISPLAY_NAMES: Readonly<Record<string, string>> = {
	"tcode-desktop": "TCode Desktop",
	"tcode-browser": "TCode Browser",
	"tcode-reply-language": "TCode Reply Language",
	"tcode-subagent-explore": "TCode Subagent Explore",
	"tcode-ai-title-en": "TCode AI Title (EN)",
	"tcode-ai-title-zh": "TCode AI Title (ZH)",
	"tcode-ui-plugin": "TCode UI Plugin",
};

export function skillDisplayName(name: string): string {
	return SKILL_DISPLAY_NAMES[name] ?? name;
}

export type SkillSpace = "daily" | "project";

export const SKILL_SPACE_DEFAULTS: Readonly<Record<string, { daily: boolean; project: boolean }>> = {
	"tcode-ui-plugin": { daily: true, project: false },
};

export const CHANNEL_SKILLS: readonly string[] = ["channel-pickup", "design-handoff"];

export function skillDefaultsOffIn(space: SkillSpace, channelWatchEnabled = false): string[] {
	const names = Object.entries(SKILL_SPACE_DEFAULTS)
		.filter(([, value]) => !value[space])
		.map(([name]) => name);
	if (!channelWatchEnabled) names.push(...CHANNEL_SKILLS);
	return names;
}

export interface LoadedSkill {
	name: string;
	description: string;

	scope: ResourceScope;

	source: string;

	path: string;

	disableModelInvocation: boolean;

	defaultDisabled?: boolean;

	spaceDefaults?: { daily: boolean; project: boolean };

	systemSkill?: boolean;

	tier?: SkillTier;
}

export const FEATURE_GATED_SKILLS: Readonly<
	Record<string, "browserControl" | "uiPlugins" | "crossSessionCollab">
> = {
	"web-annotate": "browserControl",

	"tcode-ui-plugin": "uiPlugins",

	"channel-pickup": "crossSessionCollab",
	"design-handoff": "crossSessionCollab",
};

export const LANGUAGE_GATED_SKILLS: Readonly<Record<string, "zh" | "en">> = {
	"tcode-ai-title-zh": "zh",
	"tcode-ai-title-en": "en",
};

export interface LoadedExtension {
	name: string;

	path: string;
	scope: ResourceScope;

	source: string;

	hidden: boolean;

	toolsCount: number;

	tools: string[];

	commands: string[];

	flagsCount: number;

	shortcutsCount: number;
}

export interface ResourceDiagnosticInfo {
	type: "warning" | "error" | "collision";
	message: string;
	path?: string;
}

export interface LoadedResources {
	skills: LoadedSkill[];
	skillDiagnostics: ResourceDiagnosticInfo[];
	extensions: LoadedExtension[];
	extensionErrors: { path: string; error: string }[];
}

export interface SubagentMutexEvent {
	type: "subagent_mutex";
	extensionPath: string;
	tools: string[];
}

export interface StreamGuardTrippedEvent {
	type: "stream_guard_tripped";

	verdict: string;
}

export interface AgentSayEvent {
	type: "agent_say";

	id: string;

	agent: string;

	text: string;

	at: number;

	sessionFile?: string;

	done?: boolean;
}

export interface PtcSubCallEvent {
	type: "ptc_subcall";
	phase: "start" | "end";

	id: string;

	parentToolCallId: string;
	tool: string;

	args?: string;
	ok?: boolean;
	durationMs?: number;
	error?: string;
}

export type { PiAgentSessionEvent as AgentSessionEvent };
export type SessionEvent =
	| PiAgentSessionEvent
	| SubagentMutexEvent
	| StreamGuardTrippedEvent
	| PtcSubCallEvent
	| AgentSayEvent;

export interface SessionEventEnvelope {
	sessionId: string;
	event: SessionEvent;
}
