import type { CustomThinkingLevel } from "./thinking";

export const KNOWN_APIS = [
	"openai-completions",
	"openai-responses",
	"anthropic-messages",
	"google-generative-ai",
	"google-vertex",
	"azure-openai-responses",
	"mistral-conversations",
	"bedrock-converse-stream",
	"openai-codex-responses",
	"pi-messages",
] as const;

export type KnownApiId = (typeof KNOWN_APIS)[number];

export interface ListProvidersOptions {
	forceNetwork?: boolean;
}

export interface ModelPrefs {
	hiddenModels: Record<string, string[]>;
	subagentModels: Record<string, string>;

	subagentThinking?: Record<string, string>;

	subagentPreferBuiltin?: boolean;

	mainAgentPrompt?: string;

	mainAgentName?: string;
}

export const SUBAGENT_TOOL_NAMES: readonly string[] = [
	"read",
	"grep",
	"find",
	"ls",
	"edit",
	"write",
	"bash",
	"powershell",
	"webfetch",
];

export interface SubagentInfo {
	name: string;
	description: string;
	source: "builtin" | "user";

	tools: string[];

	systemPrompt: string;

	path?: string;

	thinking?: string;

	thinkingWarning?: string;
}

export interface ProviderModelInfo {
	id: string;
	name: string;

	reasoning?: boolean;

	contextWindow?: number;

	maxTokens?: number;

	imageInput?: boolean;
}

export interface ProviderOAuthInfo {
	loginLabel?: string;

	isSubscription?: boolean;
}

export interface ProviderInfo {
	id: string;

	name: string;

	custom: boolean;
	managed?: boolean;

	overridesBuiltin?: boolean;

	configured: boolean;

	authSource?: string;
	authLabel?: string;

	oauth?: ProviderOAuthInfo;

	apiKeyLogin?: boolean;

	baseUrl?: string;

	api?: string;

	customModels?: CustomProviderModelInput[];

	models: ProviderModelInfo[];
}

export type LoginAuthPrompt =
	| { type: "text"; message: string; placeholder?: string }
	| { type: "secret"; message: string; placeholder?: string }
	| { type: "manual_code"; message: string; placeholder?: string }
	| {
			type: "select";
			message: string;
			options: readonly { id: string; label: string; description?: string }[];
	  };

export type LoginAuthEvent =
	| { type: "info"; message: string; links?: readonly { url: string; label?: string }[] }
	| { type: "auth_url"; url: string; instructions?: string }
	| {
			type: "device_code";
			userCode: string;
			verificationUri: string;
			intervalSeconds?: number;
			expiresInSeconds?: number;
	  }
	| { type: "progress"; message: string };

export type LoginEventPayload = { loginId: string } & (
	| { kind: "event"; event: LoginAuthEvent }
	| { kind: "prompt"; promptId: string; prompt: LoginAuthPrompt }
	| { kind: "prompt-cancel"; promptId: string }
);

export interface LoginResult {
	ok: boolean;

	cancelled?: boolean;
	error?: string;
}

export const OFF_THINKING_LEVEL_KEY = "off";

export const OFF_THINKING_LEVEL_VALUE = "disabled";

export type ThinkingLevelMapInput = Partial<Record<CustomThinkingLevel, string | null>>;

export interface CustomProviderModelInput {
	id: string;
	name?: string;

	reasoning?: boolean;

	contextWindow?: number;

	maxTokens?: number;

	imageInput?: boolean;

	thinkingLevelMap?: ThinkingLevelMapInput;
}

export interface CustomProviderInput {
	id: string;
	name?: string;
	baseUrl: string;

	api: string;
	models: CustomProviderModelInput[];

	apiKey?: string;
}

export type CustomProviderUpdateInput = CustomProviderInput;

export interface ProviderTestResult {
	ok: boolean;

	error?: string;

	modelId?: string;
}

export interface SkillPrefs {
	modelInvocationDisabled: string[];

	modelInvocationEnabled: string[];
}
