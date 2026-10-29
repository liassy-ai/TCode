import type {
	AgentSession,
	AgentSessionEvent,
	AgentToolResult,
	ExtensionContext,
	ModelRuntime,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { SessionEvent } from "@tcode/shared";
import { type Static, Type } from "typebox";
import type { PermissionGate } from "../../permissions/gate";
import type { SessionTraces } from "../../session/traces";
import { agentRoster, discoverAgentRosterSync, discoverAgents, findAgent } from "./agents";
import { runSubagent, type SingleResult } from "./runner";

const MAX_TASKS = 8;
const MAX_CONCURRENCY = 4;
const MAX_CONTENT = 50_000;

const taskSchema = Type.Object({
	agent: Type.String({ minLength: 1, description: "Agent definition name, e.g. Explore" }),
	task: Type.String({ minLength: 1, description: "Self-contained task for the subagent" }),
	cwd: Type.Optional(Type.String({ minLength: 1, description: "Optional working directory" })),
});

export const subagentParams = Type.Object({
	agent: Type.Optional(
		Type.String({ minLength: 1, description: "Agent definition name, e.g. Explore (single run)" }),
	),
	task: Type.Optional(
		Type.String({ minLength: 1, description: "Self-contained task for the subagent (single run)" }),
	),
	cwd: Type.Optional(Type.String({ minLength: 1, description: "Optional working directory" })),
	runId: Type.Optional(
		Type.String({
			minLength: 1,
			description:
				"Continue an existing subagent run: pass the runId from a previous result to send a follow-up to the SAME subagent (it remembers the earlier context). Mutually exclusive with tasks.",
		}),
	),
	tasks: Type.Optional(
		Type.Array(taskSchema, {
			minItems: 1,
			maxItems: MAX_TASKS,
			description: `Parallel runs (up to ${MAX_TASKS} tasks); mutually exclusive with agent/task`,
		}),
	),
	confirmProjectAgents: Type.Optional(Type.Boolean()),
});

export interface MakeSubagentToolDeps {
	getModelRuntime: () => Promise<ModelRuntime>;
	getSubagentModel: (agentName: string) => Promise<string | undefined>;

	getSubagentThinkingLevel: (agentName: string) => Promise<string | undefined>;
	gate: PermissionGate;
	traces: SessionTraces;

	onEvent?: (sessionId: string, event: AgentSessionEvent) => void;

	emitUi?: (sessionId: string, event: SessionEvent) => void;

	appendAgentMessage?: (sessionId: string, agent: string, text: string, sessionFile?: string) => void;

	getGroupContext?: (sessionId: string) => Promise<string>;
}

interface SubagentDetails {
	mode: "single" | "parallel";
	results: SingleResult[];
}

function truncate(text: string): string {
	return text.length <= MAX_CONTENT ? text : `${text.slice(0, MAX_CONTENT)}\n[truncated]`;
}

function partialResult(
	mode: SubagentDetails["mode"],
	results: SingleResult[],
): AgentToolResult<SubagentDetails> {
	return {
		content: [{ type: "text", text: "Subagent tasks are running..." }],
		details: { mode, results: results.map((result) => ({ ...result, usage: { ...result.usage } })) },
	};
}

async function withConcurrency<T>(
	items: T[],
	limit: number,
	worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
	let cursor = 0;
	const consume = async () => {
		while (cursor < items.length) {
			const index = cursor++;
			const item = items[index];
			if (item === undefined) return;
			await worker(item, index);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, consume));
}

function isFailed(result: SingleResult): boolean {
	return result.exitCode !== 0 || result.error != null;
}

function failedResult(agent: string, task: string, error: unknown): SingleResult {
	return {
		agent,
		task,
		exitCode: 1,
		error: error instanceof Error ? error.message : String(error),
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, totalTokens: { tokens: 0 } },
		artifactPaths: {},
	};
}
function continueHint(runId: string): string {
	return `\n\n[runId: ${runId}] 需要追问同一个子代理（它记得上文）时：subagent { runId: "${runId}", task: "..." }`;
}

function contentForResults(results: SingleResult[], mode: SubagentDetails["mode"]): string {
	if (mode === "single") {
		const result = results[0];
		if (!result) return "";

		if (isFailed(result)) {
			const base = `Subagent ${result.agent} failed: ${result.error ?? "aborted"}`;
			return result.runId ? `${base}${continueHint(result.runId)}` : base;
		}
		const base = truncate(result.content ?? "");
		return result.runId ? `${base}${continueHint(result.runId)}` : base;
	}
	return truncate(
		results
			.map((result, index) => {
				const header = `## ${index + 1}. ${result.agent}`;

				const body = result.error ? `Error: ${result.error}` : (result.content ?? "");
				const tag = result.runId ? `\n[runId: ${result.runId}]` : "";
				return `${header}\n${truncate(body)}${tag}`;
			})
			.join("\n\n"),
	);
}

export function finalizeSubagentResult(
	mode: SubagentDetails["mode"],
	results: SingleResult[],
): AgentToolResult<SubagentDetails> {
	const anyFailed = results.some(isFailed);
	const allFailed = results.length > 0 && results.every(isFailed);
	const isError = mode === "single" ? anyFailed : allFailed;
	return {
		content: [{ type: "text", text: contentForResults(results, mode) }],
		details: { mode, results },
		...(isError ? { isError: true } : {}),
	};
}

async function confirmProjectAgents(
	ctx: ExtensionContext,
	shouldConfirm: boolean,
	agents: Array<{ name: string; source: string }>,
): Promise<void> {
	const projectNames = [
		...new Set(agents.filter((agent) => agent.source === "project").map((agent) => agent.name)),
	];
	if (!shouldConfirm || projectNames.length === 0 || !ctx.hasUI) return;
	const allowed = await ctx.ui.confirm(
		"Allow project subagent definitions?",
		`This project provides subagent definitions: ${projectNames.join(", ")}. Their instructions will be executed in isolated sessions.`,
	);
	if (!allowed) throw new Error("Project subagent definitions were not approved");
}

export function makeSubagentTool(deps: MakeSubagentToolDeps): ToolDefinition {
	const roster = agentRoster(discoverAgentRosterSync());

	const runs = new Map<string, { sessionFile: string; agent: string; cwd: string }>();

	const inFlight = new Set<string>();

	const resident = new Map<string, AgentSession>();
	const residentBusy = new Set<string>();
	const registerRun = (result: SingleResult, cwd: string): void => {
		const file = result.artifactPaths.jsonlPath;
		if (!file || !result.sessionId) return;
		runs.set(result.sessionId, { sessionFile: file, agent: result.agent, cwd });
		result.runId = result.sessionId;
	};
	return {
		name: "subagent",
		label: "Subagent",
		description: `Delegate a self-contained read-only or project-scoped task to an isolated subagent session: {agent, task} for one run, or {tasks:[{agent, task}, ...]} for parallel exploration (up to 8 tasks, 4 at once); each run is an independent session. To ask a follow-up to the SAME subagent (which keeps the earlier context), call again with {runId, task} using the runId shown in the previous result. Available agents — ${roster}. More assistants can be added in TCode settings (assistant configuration, ~/.pi/agent/agents/*.md). Only the subagent's final conclusion returns.`,
		parameters: subagentParams,
		execute: async (
			toolCallId,
			rawParams,
			signal,
			onUpdate,
			ctx,
		): Promise<AgentToolResult<SubagentDetails>> => {
			void toolCallId;
			const params = rawParams as Static<typeof subagentParams>;
			const shouldConfirm = params.confirmProjectAgents !== false;
			const projectTrusted = ctx.isProjectTrusted();
			const continueRunId = params.runId?.trim() || undefined;

			let mainSessionId: string | undefined;
			try {
				mainSessionId = ctx.sessionManager.getSessionId();
			} catch {
				mainSessionId = undefined;
			}

			const groupContext =
				mainSessionId && deps.getGroupContext ? await deps.getGroupContext(mainSessionId) : "";
			const emitSay = (agent: string, id: string, text: string, sessionFile?: string): void => {
				if (mainSessionId)
					deps.emitUi?.(mainSessionId, {
						type: "agent_say",
						id,
						agent,
						text,
						at: Date.now(),
						...(sessionFile ? { sessionFile } : {}),
					});
			};

			const sayFromAgent =
				(agent: string) =>
				(say: { id: string; text: string; done: boolean; sessionFile?: string }): void => {
					emitSay(agent, say.id, say.text, say.sessionFile);
					if (say.done && say.text.trim() && mainSessionId)
						deps.appendAgentMessage?.(mainSessionId, agent, say.text, say.sessionFile);
				};

			const relayMentions = async (seed: SingleResult[], cwd: string): Promise<SingleResult[]> => {
				const spoken = new Set(seed.map((r) => r.agent));
				const extra: SingleResult[] = [];
				const queue = seed.map((r) => r.content ?? "");
				let budget = 2;
				while (queue.length > 0 && budget > 0) {
					const text = queue.shift() ?? "";
					if (!text.includes("@")) continue;
					const roster = await discoverAgents(cwd, { projectTrusted });
					for (const a of roster) {
						if (budget <= 0) break;
						if (spoken.has(a.name) || !text.includes(`@${a.name}`)) continue;
						spoken.add(a.name);
						budget -= 1;
						const key = `${a.name}|${cwd}`;
						const cachedSession = resident.get(key);
						const reuse = cachedSession && !residentBusy.has(key) ? cachedSession : undefined;
						residentBusy.add(key);
						let r: SingleResult;
						try {
							r = await runSubagent(deps, {
								agent: a,
								task: `群里 @ 了你，请结合群聊上下文接着回应：\n${text}`,
								cwd,
								projectTrusted,
								model: ctx.model,
								signal,
								...(reuse ? { existingSession: reuse } : {}),
								...(groupContext ? { promptPrefix: groupContext } : {}),
								keepAlive: true,
								onSession: (session) => resident.set(key, session),
								onSay: sayFromAgent(a.name),
							});
						} catch (error) {
							r = failedResult(a.name, text, error);
						} finally {
							residentBusy.delete(key);
						}
						registerRun(r, cwd);
						extra.push(r);
						queue.push(r.content ?? "");
					}
				}
				return extra;
			};

			if (continueRunId) {
				if (params.tasks?.length) {
					throw new Error('Use either "runId" (continue one run) or "tasks" (parallel), not both');
				}
				if (!params.task) {
					throw new Error('Missing "task": continuing a run needs the follow-up task text');
				}
				const run = runs.get(continueRunId);
				if (!run) {
					throw new Error(
						`Unknown runId "${continueRunId}": only runs started in this session can be continued (lost after a restart)`,
					);
				}
				if (inFlight.has(run.sessionFile)) {
					throw new Error(`Run "${continueRunId}" is still running; wait for it before continuing`);
				}
				const agents = await discoverAgents(run.cwd, { projectTrusted });
				const agent = findAgent(agents, run.agent);
				const residentKey = `${agent.name}|${run.cwd}`;
				const cached = resident.get(residentKey);
				const reuse = cached && !residentBusy.has(residentKey) ? cached : undefined;
				let result: SingleResult;
				inFlight.add(run.sessionFile);
				residentBusy.add(residentKey);
				try {
					result = await runSubagent(deps, {
						agent,
						task: params.task,
						cwd: run.cwd,
						projectTrusted,
						model: ctx.model,
						signal,
						...(reuse ? { existingSession: reuse } : { resumeSessionFile: run.sessionFile }),
						...(groupContext ? { promptPrefix: groupContext } : {}),
						keepAlive: true,
						onSession: (session) => resident.set(residentKey, session),
						onSay: sayFromAgent(agent.name),
					});
				} catch (error) {
					result = failedResult(agent.name, params.task, error);
				} finally {
					inFlight.delete(run.sessionFile);
					residentBusy.delete(residentKey);
				}
				registerRun(result, run.cwd);
				const relayed = await relayMentions([result], run.cwd);
				return finalizeSubagentResult("single", [result, ...relayed]);
			}

			const parallelTasks = params.tasks?.length ? params.tasks : undefined;
			let tasks: Array<Static<typeof taskSchema>>;
			if (parallelTasks) {
				tasks = parallelTasks;
			} else {
				if (!params.agent || !params.task) {
					throw new Error(
						'Missing "agent"/"task": pass { agent, task } for one run or { tasks: [...] } for parallel',
					);
				}
				tasks = [{ agent: params.agent, task: params.task, ...(params.cwd ? { cwd: params.cwd } : {}) }];
			}
			const mode: SubagentDetails["mode"] = parallelTasks ? "parallel" : "single";
			const definitions = await Promise.all(
				tasks.map(async (task) => {
					const cwd = task.cwd ?? ctx.cwd;
					const agents = await discoverAgents(cwd, { projectTrusted });
					return { task, cwd, agents, agent: findAgent(agents, task.agent) };
				}),
			);
			await confirmProjectAgents(
				ctx,
				shouldConfirm,
				definitions.map(({ agent }) => agent),
			);

			const slots: Array<SingleResult | undefined> = new Array(definitions.length);
			const filled = () => slots.filter((slot): slot is SingleResult => slot !== undefined);
			const emit = () => onUpdate?.(partialResult(mode, filled()));
			await withConcurrency(definitions, MAX_CONCURRENCY, async ({ task, cwd, agent }, index) => {
				const residentKey = `${agent.name}|${cwd}`;
				const cached = resident.get(residentKey);
				const reuse = cached && !residentBusy.has(residentKey) ? cached : undefined;
				let result: SingleResult;
				residentBusy.add(residentKey);
				try {
					result = await runSubagent(deps, {
						agent,
						task: task.task,
						cwd,
						projectTrusted,
						model: ctx.model,
						signal,
						...(reuse ? { existingSession: reuse } : {}),
						...(groupContext ? { promptPrefix: groupContext } : {}),
						keepAlive: true,
						onSession: (session) => resident.set(residentKey, session),
						onSay: sayFromAgent(agent.name),
						onProgress: (progress) => {
							slots[index] = progress;
							emit();
						},
					});
				} catch (error) {
					result = failedResult(agent.name, task.task, error);
				} finally {
					residentBusy.delete(residentKey);
				}
				registerRun(result, cwd);
				slots[index] = result;
				emit();
			});
			const results = filled();
			const relayed = await relayMentions(results, tasks[0]?.cwd ?? ctx.cwd);
			return finalizeSubagentResult(mode, [...results, ...relayed]);
		},
	};
}
