import type { UiError } from "../errors";
import type { ImageInput } from "../session";
import type { SkillInvocationDisplay } from "../skill-invocation";
import type { TodoItem } from "../todo";

export interface RetryInfo {
	attempt: number;
	maxAttempts: number;
	delayMs: number;
}

export interface SubagentRunUi {
	key: string;
	agent: string;
	task?: string;
	status: "running" | "done" | "error";
	model?: string;

	thinkingLevel?: string;
	tokens?: number;
	exitCode?: number;
	artifactsDir?: string;

	sessionFile?: string;

	result?: string;
}

interface UIBaseMessage {
	id: string;
	text: string;
	timestamp: number;

	entryId?: string;

	sourceText?: string;
}

export type UIMessage =
	| (UIBaseMessage & {
			kind: "user";
			images: ImageInput[];

			skill?: SkillInvocationDisplay;
	  })
	| (UIBaseMessage & {
			kind: "assistant";
			thinking: string;
			tools: UIToolCall[];
	  })
	| {
			kind: "error";
			id: string;
			text: string;
			timestamp: number;
			error: UiError;
	  }
	| {
			kind: "system";
			id: string;
			text: string;
			timestamp: number;
			compact?: CompactionUiState;

			mutex?: { extensionPath: string; tools: string[] };
	  }
	| {
			kind: "image";
			id: string;
			images: ImageInput[];
			paths: string[];
			timestamp: number;
	  }
	| {
			kind: "subagent";
			id: string;
			runs: SubagentRunUi[];
			timestamp: number;
	  }
	| {
			kind: "agent";
			id: string;
			text: string;
			timestamp: number;
			agent: string;

			sessionFile?: string;

			streaming?: boolean;
	  };

export type CompactionReason = "manual" | "threshold" | "overflow";

export interface CompactionUiState {
	status: "running" | "done" | "cancelled" | "error";

	reason?: CompactionReason;
	summary?: string;
	tokensBefore?: number;

	tokensAfter?: number;
	errorMessage?: string;
}

export interface UIToolCall {
	key: string;
	id: string;
	name: string;

	args: string;

	output: string;

	diff?: string;
	state: "running" | "done" | "error";

	endedAt?: number;

	blockIndex?: number;

	subCallTotal?: number;
}

export type ActivityEntry =
	| { id: string; kind: "thinking"; text: string }
	| { id: string; kind: "tool"; name: string; args: string };

export interface StreamingState {
	id: string;

	startedAt: number;
	text: string;
	thinking: string;
	tools: UIToolCall[];

	pendingImages: { images: ImageInput[]; paths: string[] }[];

	subagentRuns: SubagentRunUi[];

	subagentByToolCallId: Record<string, { start: number; count: number }>;

	activeToolIndex: number;

	toolByContentIndex: Record<number, number>;

	rawToolOutputs?: Record<string, string>;

	activity: ActivityEntry[];

	textBlockIndex: number | null;
}

export type SessionPhase = "idle" | "streaming" | "awaiting_permission";

export interface SessionTranscriptState {
	messages: UIMessage[];
	streaming: StreamingState | null;
	phase: SessionPhase;

	agentActive: boolean;

	unseenCompletion: boolean;

	followUpQueue: string[];

	compacting: boolean;

	todos: TodoItem[];

	pendingLlmError: UiError | null;

	retrying: RetryInfo | null;

	runEndedAt?: number;
}

export function emptyTranscript(): SessionTranscriptState {
	return {
		messages: [],
		streaming: null,
		phase: "idle",
		agentActive: false,
		unseenCompletion: false,
		followUpQueue: [],
		compacting: false,
		todos: [],
		pendingLlmError: null,
		retrying: null,
	};
}
