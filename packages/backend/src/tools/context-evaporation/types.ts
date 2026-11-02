export interface EvapTiers {
	snip: number;

	prune: number;

	summarize: number;
}

export interface EvapConfig {
	tiers: EvapTiers;

	budgetTokens: number;

	protectionTokens: number;

	keepRecentImages: number;

	headLines: number;
	tailLines: number;

	headTailThreshold: number;

	tier2Scope: "all" | "gt4k";

	trimAssistantText: boolean;

	protectedTools: string[];
}

export const DEFAULT_EVAP_CONFIG: EvapConfig = {
	tiers: { snip: 60, prune: 85, summarize: 95 },
	budgetTokens: 262144,
	protectionTokens: 8000,
	keepRecentImages: 3,
	headLines: 15,
	tailLines: 25,
	headTailThreshold: 4096,
	tier2Scope: "all",
	trimAssistantText: false,
	protectedTools: ["todo"],
};

export type EvapLevel = "snip" | "stub";

export interface EvapDecision {
	level: EvapLevel;
}

export type EvapDecisionMap = Map<string, EvapDecision>;

export interface EvapState {
	decisions: EvapDecisionMap;
}

export function createEvapState(): EvapState {
	return { decisions: new Map() };
}

export interface EvapBatchInfo {
	tier: number;

	usagePct: number;

	wireEstTokens: number;

	snipped: number;

	pruned: number;

	savedEstTokens: number;

	cacheHits: number;
	mapSize: number;
}

export interface EvapTextBlock {
	type: "text";
	text: string;

	textSignature?: string;
	[k: string]: unknown;
}

export interface EvapImageBlock {
	type: "image";
	data: string;
	mimeType: string;
	[k: string]: unknown;
}

export interface EvapUserMessage {
	role: "user";
	content: string | (EvapTextBlock | EvapImageBlock)[];
	[k: string]: unknown;
}

export interface EvapAssistantMessage {
	role: "assistant";
	content: unknown[];
	[k: string]: unknown;
}

export interface EvapToolResultMessage {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: unknown[];
	isError?: boolean;
	details?: unknown;
	[k: string]: unknown;
}

export type EvapWireMessage =
	| EvapUserMessage
	| EvapAssistantMessage
	| EvapToolResultMessage
	| {
			role: string;
			[k: string]: unknown;
	  };

export type EvapClass =
	| "userText"
	| "image"
	| "assistantText"
	| "toolCall"
	| "read"
	| "command"
	| "external"
	| "editWrite"
	| "protected";

export type EvapPartKind =
	| "userString"
	| "userText"
	| "userImage"
	| "trText"
	| "trImage"
	| "assistantText"
	| "toolCall";

export interface EvapPartInfo {
	cls: EvapClass;
	kind: EvapPartKind;
	key: string;
	messageIndex: number;

	blockIndex: number;
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;

	pinned?: boolean;

	text?: string;

	tFull: number;
	tSnip: number;
	tStub: number;
	tFold: number;
	tTrim: number;

	stubbable: boolean;
	bytes: number;
}

export interface EvapPartView {
	cls: EvapClass;
	key: string;
	toolCallId?: string;
	isError?: boolean;

	level: EvapLevel | "full";

	tokens: number;
	tFull: number;

	tSnip: number;
	tStub: number;
	bytes: number;
	messageIndex: number;
}
