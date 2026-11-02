import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import type {
	AgentSession,
	AgentSessionEvent,
	ModelRuntime,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { isThinkingLevel, type SessionEvent, type ThinkingLevel } from "@tcode/shared";
import { makePermissionGateExtension } from "../../permissions/extension";
import type { PermissionGate, PermissionRequestMeta } from "../../permissions/gate";
import { toSdkThinkingLevel } from "../../session/thinking";
import type { SessionTraces } from "../../session/traces";
import { makeUiContext } from "../../session/ui-context";
import { makeWebFetchTool } from "../webfetch";
import type { SubagentDefinition } from "./agents";

export interface SubagentUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	totalTokens: { tokens: number };
}

export interface SingleResult {
	agent: string;
	task: string;
	model?: string;

	sessionId?: string;

	runId?: string;

	thinkingLevel?: string;
	exitCode: number;
	error?: string;
	content?: string;
	usage: SubagentUsage;
	artifactPaths: { jsonlPath?: string };
}

export interface RunSubagentInput {
	agent: SubagentDefinition;
	task: string;
	cwd: string;

	projectTrusted: boolean;
	model?: Model<any>;
	signal?: AbortSignal;
	onProgress?: (result: SingleResult) => void;

	resumeSessionFile?: string;

	onSay?: (say: { id: string; text: string; done: boolean; sessionFile?: string }) => void;

	existingSession?: AgentSession;

	keepAlive?: boolean;

	onSession?: (session: AgentSession) => void;

	promptPrefix?: string;
}

export interface RunSubagentDeps {
	getModelRuntime: () => Promise<ModelRuntime>;

	getSubagentModel: (agentName: string) => Promise<string | undefined>;

	getSubagentThinkingLevel: (agentName: string) => Promise<string | undefined>;
	gate: PermissionGate;
	traces: SessionTraces;

	onEvent?: (sessionId: string, event: AgentSessionEvent) => void;

	emitUi?: (sessionId: string, event: SessionEvent) => void;
}

const EMPTY_USAGE: SubagentUsage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	cost: 0,
	totalTokens: { tokens: 0 },
};

export function subagentSessionsRoot(agentDir: string = getAgentDir()): string {
	return join(agentDir, "sessions-subagents");
}

export function isSubagentSessionPath(filePath: string, agentDir?: string): boolean {
	const root = resolve(subagentSessionsRoot(agentDir));
	const normalized = resolve(filePath);
	return normalized === root || normalized.startsWith(root + sep);
}

function projectSlug(cwd: string): string {
	const slug = cwd.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
	return slug || "default";
}

export async function resolveModel(
	runtime: ModelRuntime,
	spec: string | undefined,
	fallback: Model<any> | undefined,
): Promise<Model<any> | undefined> {
	if (!spec) return fallback;
	const slash = spec.indexOf("/");
	if (slash > 0) return runtime.getModel(spec.slice(0, slash), spec.slice(slash + 1)) ?? fallback;
	const matches = (await runtime.getAvailable()).filter((model) => model.id === spec);
	return matches.length === 1 ? matches[0] : fallback;
}

export async function resolveSubagentModel(
	runtime: ModelRuntime,
	preference: string | undefined,
	frontmatter: string | undefined,
	fallback: Model<any> | undefined,
): Promise<Model<any> | undefined> {
	return resolveModel(runtime, preference ?? frontmatter, fallback);
}

export function resolveSubagentThinkingLevel(
	preference: string | undefined,
	frontmatter: ThinkingLevel | undefined,
): ThinkingLevel | undefined {
	return isThinkingLevel(preference) ? preference : frontmatter;
}

export function subagentSessionName(agent: string, task: string): string {
	const firstLine = (task.trim().split("\n")[0] ?? "").trim();
	const title = firstLine.length > 30 ? `${firstLine.slice(0, 30)}…` : firstLine;
	return title ? `${agent}: ${title}` : agent;
}

function textOfMessage(message: unknown): string {
	const msg = message as { role?: string; content?: unknown[] } | undefined;
	if (msg?.role !== "assistant" || !Array.isArray(msg.content)) return "";
	return msg.content
		.filter((block): block is { type: "text"; text: string } => {
			const item = block as { type?: string; text?: unknown };
			return item.type === "text" && typeof item.text === "string";
		})
		.map((block) => block.text)
		.join("")
		.trim();
}

function assistantText(session: { messages: readonly unknown[] }): string {
	const messages = [...session.messages].reverse();
	const assistant = messages.find((message) => (message as { role?: string }).role === "assistant") as
		| { content?: unknown[] }
		| undefined;
	if (!assistant || !Array.isArray(assistant.content)) return "";
	return assistant.content
		.filter((block): block is { type: "text"; text: string } => {
			const item = block as { type?: string; text?: unknown };
			return item.type === "text" && typeof item.text === "string";
		})
		.map((block) => block.text)
		.join("")
		.trim();
}

type UsageDelta = {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: number;
	totalTokens?: number;
};

function usageFromMessage(message: unknown): UsageDelta {
	const usage = (message as { usage?: Record<string, unknown> } | undefined)?.usage;
	if (!usage) return {};
	const cost = usage.cost as { total?: unknown } | undefined;
	return {
		input: typeof usage.input === "number" ? usage.input : undefined,
		output: typeof usage.output === "number" ? usage.output : undefined,
		cacheRead: typeof usage.cacheRead === "number" ? usage.cacheRead : undefined,
		cacheWrite: typeof usage.cacheWrite === "number" ? usage.cacheWrite : undefined,
		cost: typeof cost?.total === "number" ? cost.total : undefined,
		totalTokens: typeof usage.totalTokens === "number" ? usage.totalTokens : undefined,
	};
}

function addUsage(target: SubagentUsage, delta: UsageDelta): void {
	target.input += delta.input ?? 0;
	target.output += delta.output ?? 0;
	target.cacheRead += delta.cacheRead ?? 0;
	target.cacheWrite += delta.cacheWrite ?? 0;
	target.cost += delta.cost ?? 0;

	if (typeof delta.totalTokens === "number") {
		target.totalTokens.tokens = Math.max(target.totalTokens.tokens, delta.totalTokens);
	}
}

function modelLabel(model: Model<any> | undefined): string | undefined {
	return model ? `${model.provider}/${model.id}` : undefined;
}

let saySeq = 0;

export async function runSubagent(deps: RunSubagentDeps, input: RunSubagentInput): Promise<SingleResult> {
	let session: AgentSession;
	if (input.existingSession) {
		session = input.existingSession;
	} else {
		const runtime = await deps.getModelRuntime();
		const model = await resolveSubagentModel(
			runtime,
			await deps.getSubagentModel(input.agent.name),
			input.agent.model,
			input.model,
		);

		const thinkingLevel = toSdkThinkingLevel(
			resolveSubagentThinkingLevel(
				await deps.getSubagentThinkingLevel(input.agent.name),
				input.agent.thinking,
			),
		);
		const agentDir = getAgentDir();
		const sessionDir = join(subagentSessionsRoot(agentDir), projectSlug(input.cwd));
		const childGateConfirm = (title: string, message: string, meta?: PermissionRequestMeta) =>
			deps.gate.confirm(`[${input.agent.name}] ${title}`, message, meta);
		const childSettings = SettingsManager.create(input.cwd, agentDir, {
			projectTrusted: input.projectTrusted,
		});
		const safeTools = input.agent.tools.filter(
			(name) => name !== "subagent" && !name.startsWith("subagent_"),
		);
		const customTools: ToolDefinition[] = safeTools.includes("webfetch") ? [makeWebFetchTool()] : [];
		const resourceLoader = new DefaultResourceLoader({
			cwd: input.cwd,
			agentDir,
			settingsManager: childSettings,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			appendSystemPrompt: [input.agent.systemPrompt],
			extensionFactories: [
				makePermissionGateExtension(agentDir, {
					projectRoot: input.cwd,
					confirm: childGateConfirm,
				}),
			],
		});
		await resourceLoader.reload();

		const sessionManager = input.resumeSessionFile
			? SessionManager.open(input.resumeSessionFile, sessionDir)
			: SessionManager.create(input.cwd, sessionDir);
		const { session: createdSession } = await createAgentSession({
			cwd: input.cwd,
			agentDir,
			modelRuntime: runtime,
			model,
			thinkingLevel,
			tools: safeTools,
			customTools,
			sessionManager,
			settingsManager: childSettings,
			resourceLoader,
		});
		session = createdSession;

		if (!input.resumeSessionFile) {
			session.setSessionName(subagentSessionName(input.agent.name, input.task));
		}

		await session.bindExtensions({ uiContext: makeUiContext({}), mode: "rpc" });

		if (input.keepAlive) input.onSession?.(session);
	}
	const result: SingleResult = {
		agent: input.agent.name,
		task: input.task,
		sessionId: session.sessionId,
		model: modelLabel(session.model),

		thinkingLevel: session.thinkingLevel,
		exitCode: -1,
		usage: structuredClone(EMPTY_USAGE),
		artifactPaths: { jsonlPath: session.sessionFile },
	};
	let settled = false;
	let failure: string | undefined;
	let unsubscribeEvents: (() => void) | undefined;

	let currentSayId: string | undefined;
	let lastSayAt = 0;
	const sayId = (): string => {
		if (!currentSayId) currentSayId = `say-${++saySeq}`;
		return currentSayId;
	};

	const endPromise = new Promise<void>((resolve) => {
		unsubscribeEvents = session.subscribe((event: AgentSessionEvent) => {
			if (deps.onEvent) deps.onEvent(session.sessionId, event);
			else deps.traces.record(session.sessionId, event);
			if (event.type === "message_start") {
				const role = (event as { message?: { role?: unknown } }).message?.role;
				if (role === "assistant") currentSayId = `say-${++saySeq}`;
			}
			if (event.type === "message_end") {
				addUsage(result.usage, usageFromMessage(event.message));

				const role = (event as { message?: { role?: unknown } }).message?.role;
				if (role === "assistant") {
					const said = textOfMessage((event as { message?: unknown }).message);
					if (said) input.onSay?.({ id: sayId(), text: said, done: true, sessionFile: session.sessionFile });
				}
			}

			if (event.type === "message_update") {
				const snapshot = assistantText(session);
				if (snapshot) {
					const now = Date.now();
					if (input.onSay && now - lastSayAt >= 90) {
						lastSayAt = now;
						input.onSay({ id: sayId(), text: snapshot, done: false, sessionFile: session.sessionFile });
					}

					if (input.onProgress && snapshot !== result.content) {
						result.content = snapshot;
						input.onProgress(result);
					}
				}
			}
			if (event.type === "agent_settled") {
				settled = true;
				resolve();
			}
		});
	});
	const abort = () => {
		void session.abort();
	};
	if (input.signal) {
		if (input.signal.aborted) abort();
		else input.signal.addEventListener("abort", abort, { once: true });
	}
	try {
		input.onProgress?.(result);
		await deps.traces.start(session.sessionId, session.sessionManager.getSessionDir());

		const promptText = input.promptPrefix?.trim()
			? `${input.promptPrefix}\n\n【你的任务】\n${input.task}`
			: input.task;
		await session.prompt(promptText, { expandPromptTemplates: false });
		if (!settled) await endPromise;
		result.content = assistantText(session);
		result.exitCode = input.signal?.aborted ? 1 : 0;

		const lastAssistant = [...session.messages]
			.reverse()
			.find((message) => (message as { role?: string }).role === "assistant") as
			| { stopReason?: string; errorMessage?: string }
			| undefined;
		if (lastAssistant?.stopReason === "error") {
			result.exitCode = 1;
			result.error = lastAssistant.errorMessage ?? "subagent model error";
		}
	} catch (error) {
		failure = error instanceof Error ? error.message : String(error);
		result.exitCode = 1;
		result.error = failure;
	} finally {
		unsubscribeEvents?.();
		input.signal?.removeEventListener("abort", abort);
		await deps.traces.stop(session.sessionId);

		if (!input.keepAlive) session.dispose();
	}
	if (failure && !result.error) result.error = failure;

	if (result.usage.totalTokens.tokens === 0) {
		result.usage.totalTokens.tokens = result.usage.input + result.usage.output;
	}

	if (result.artifactPaths.jsonlPath && !existsSync(result.artifactPaths.jsonlPath)) {
		result.artifactPaths = {};
	}
	return result;
}
