import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { AssistantMessage, Model, ThinkingLevel } from "@earendil-works/pi-ai";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import {
	type AgentSession,
	type CreateAgentSessionResult,
	createAgentSession,
	type DefaultResourceLoader,
	type ExtensionError,
	getAgentDir,
	ModelRuntime,
	ProjectTrustStore,
	type ResourceLoader,
	type SessionEntry,
	type SessionInfo,
	SessionManager,
	type SettingsManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
	AvailableModel,
	ContextManagerMode,
	ContextUsageInfo,
	CreateSessionOptions,
	ExtensionDialogRequest,
	ExtensionDialogResolved,
	ExtensionDialogRespond,
	ExtensionEditorTextEvent,
	ExtensionNotifyEvent,
	ImageInput,
	LoadedResources,
	LoginEventPayload,
	PermissionAnswer,
	PermissionMode,
	PermissionRequest,
	PermissionResolved,
	QuotaInfo,
	SessionCloseIntent,
	SessionEvent,
	SessionMessage,
	SessionMeta,
	SessionModelUsage,
	SessionStats,
	SessionToolCall,
	SkillPrefs,
	SkillSpace,
	SlashCommandInfo,
	SubagentInfo,
	TrustAnswer,
	TrustRequest,
} from "@tcode/shared";
import {
	AGENT_MESSAGE_CUSTOM_TYPE,
	extractTodos,
	formatSkillCommand,
	LANGUAGE_GATED_SKILLS,
	parseExpandedSkillInvocation,
	SKILL_SPACE_DEFAULTS,
	skillDefaultsOffIn,
	skillTierOf,
	TODO_REMINDER_CUSTOM_TYPE,
	TODO_TOOL_NAME,
	type TodoItem,
} from "@tcode/shared";
import { Emitter } from "./emitter";
import { createLogger } from "./log";
import { PackageAdmin } from "./packages/admin";
import { createPermissionEvaluator, loadPermissionConfig } from "./permissions";
import {
	makePermissionGateExtension,
	type PermissionConfirm,
	type PermissionModeRef,
} from "./permissions/extension";
import { PermissionGate } from "./permissions/gate";
import { TrustGate } from "./project/trust";
import { ProjectResourceLoader } from "./project/trust-loader";
import { addAllowedPattern, addWorkspaceRoot } from "./project/workspace-store";
import {
	type AiTitleAttempt,
	applyAiTitle,
	composeTitleInput,
	firstUserMessageText,
	generateAiTitle,
	messageStartText,
	repairMessageText,
	shouldTitleAgain,
	shouldTitleWithAi,
	type TitleLanguage,
	userMessageTexts,
} from "./session/ai-title";
import { slimBulkyEvent, slimMessageUpdate } from "./session/event-slim";
import { ExtensionDialogHost } from "./session/extension-dialog-host";
import { SessionHydrationGate } from "./session/hydration-gate";
import { makeMainAgentPersonaExtension } from "./session/main-agent-persona";
import {
	blockImages,
	blockText,
	type RawMessage,
	readModelUsageFromContent,
	readSessionMessagesFromContent,
	resolveForkEntryId,
	resolveRecallEntryId,
	runCodeSubCallRows,
	toBranchSessionMessages,
} from "./session/messages";
import { autoNameSession } from "./session/naming";
import { EventRateTracker } from "./session/rates";
import { type EventForwarder, type RegisteredSession, SessionRegistry } from "./session/registry";
import { renameSessionFile } from "./session/rename";
import { makeReplyLanguageExtension } from "./session/reply-language";
import { SessionWatcher } from "./session/session-watcher";
import { KeyedSingleFlight } from "./session/single-flight";
import { StreamGuard } from "./session/stream-guard";
import { toSdkThinkingLevel } from "./session/thinking";
import { TraceRecorder } from "./session/trace";
import { SessionTraces } from "./session/traces";
import { makeUiContext } from "./session/ui-context";
import { LoginService } from "./settings/login";
import {
	buildManagedProvider,
	type ManagedProviderSpec,
	managedContextWindow,
	parseManagedProviders,
} from "./settings/managed-providers";
import { ModelPrefsService } from "./settings/model-prefs";
import { makeQuotaService } from "./settings/quota";
import { SettingsService } from "./settings/settings";
import { SkillPrefsService } from "./settings/skill-prefs";
import { deleteUserAgent, saveUserAgent } from "./settings/user-agents";
import { createUserSkill, deleteUserSkill, SEEDED_BUILTIN_SKILLS } from "./settings/user-skills";
import { slashCommandsForLoader, slashCommandsForSession } from "./slash-commands";
import { makeAskUserTool } from "./tools/ask-user";
import {
	makeChannelWatchExtension,
	readChannelWatchEnabled,
	writeChannelWatchEnabled,
} from "./tools/channel-watch";
import {
	makeEvapExtension,
	readContextManagerMode,
	reportEvapBatch,
	writeContextManagerMode,
} from "./tools/context-evaporation";
import { makePtcExtension } from "./tools/ptc";
import { makeShotHydrationExtension } from "./tools/shot-hydration";
import { makeShowImageTool } from "./tools/show-image";
import {
	discoverAgents,
	isSubagentSessionPath,
	type MakeSubagentToolDeps,
	makeSubagentTool,
} from "./tools/subagent";
import { applySubagentMutex, resolveSubagentPreferBuiltin } from "./tools/subagent/mutex";
import { makeTodoTool } from "./tools/todo";
import { makeTodoReminderExtension } from "./tools/todo-reminder";
import { makeWebFetchTool } from "./tools/webfetch";

const log = createLogger("backend");

const sessionUsageCache = new Map<string, { sig: string; byModel: SessionModelUsage[] }>();

function sessionInfoToMeta(
	info: SessionInfo,
	opts: { cwdFallback: string; active: boolean; readOnly?: boolean },
): SessionMeta {
	return {
		sessionId: info.id,
		sessionFile: info.path,
		cwd: info.cwd || opts.cwdFallback,
		name: info.name,
		active: opts.active,
		readOnly: opts.readOnly || undefined,
		messageCount: info.messageCount,
		createdAt: info.created.getTime(),
		modifiedAt: info.modified.getTime(),
	};
}
export interface PiBackendOptions {
	defaultCwd?: string;

	tools?: string[];

	customTools?: ToolDefinition[];

	permissionGates?: boolean;

	permissionExtension?: boolean;

	projectTrust?: boolean;

	webFetch?: boolean | { allowRanges?: string[] };

	subagentPreferBuiltin?: boolean;

	desktopIntegration?: {
		appendSystemPrompt: string[] | (() => string[]);
		additionalSkillPaths: string[];
	};

	dailyDir?: string;

	pluginUserData?: string;
	featureGates?: {
		warm: () => Promise<{ skills: ReadonlySet<string>; tools: ReadonlySet<string> }>;
		get: () => { skills: ReadonlySet<string>; tools: ReadonlySet<string> };
	};
}

export class PiBackend {
	private readonly registry = new SessionRegistry();

	private readonly openFlights = new KeyedSingleFlight<SessionMeta>();

	private readonly channelSubscriptionIds = new Map<string, Set<string>>();

	readonly modelPrefs = new ModelPrefsService(join(getAgentDir(), "model-prefs.json"));

	readonly skillPrefs = new SkillPrefsService(join(getAgentDir(), "skill-prefs.json"), getAgentDir());

	readonly packages: PackageAdmin;
	private readonly eventEmitter = new Emitter<{ sessionId: string; event: SessionEvent }>();
	private readonly permissionEmitter = new Emitter<PermissionRequest>();
	private readonly permissionResolvedEmitter = new Emitter<PermissionResolved>();
	private readonly trustEmitter = new Emitter<TrustRequest>();
	private readonly loginEmitter = new Emitter<LoginEventPayload>();
	private readonly extensionDialogRequestEmitter = new Emitter<ExtensionDialogRequest>();
	private readonly extensionDialogResolvedEmitter = new Emitter<ExtensionDialogResolved>();
	private readonly extensionNotifyEmitter = new Emitter<ExtensionNotifyEvent>();
	private readonly extensionEditorTextEmitter = new Emitter<ExtensionEditorTextEvent>();

	private readonly trustStore = new ProjectTrustStore(getAgentDir());
	private readonly trustGate = new TrustGate((req) => this.trustEmitter.emit(req));

	private readonly traces = new SessionTraces();
	private readonly streamGuard = new StreamGuard();
	private readonly historyGate = new SessionHydrationGate();

	private readonly aiTitleState = new WeakMap<AgentSession, AiTitleAttempt>();

	private uiLanguage: TitleLanguage = "zh";

	private chatLanguage: TitleLanguage = "zh";

	private readonly channelWatchCleanups = new WeakMap<PermissionModeRef, () => void>();

	private readonly eventRates = new EventRateTracker();
	private modelRuntime: ModelRuntime | undefined;
	private modelPromise: Promise<ModelRuntime> | undefined;

	private pluginProvidersRaw: unknown = null;
	private pluginProviderIds = new Set<string>();
	private readonly builtinProviderIds = new Set(builtinProviders().map((provider) => provider.id));

	readonly settings = new SettingsService(() => this.getModelRuntime());

	private readonly quota = makeQuotaService(() => this.getModelRuntime());

	readonly login = new LoginService({
		getRuntime: () => this.getModelRuntime(),
		send: (payload) => this.loginEmitter.emit(payload),
	});

	private readonly projectLoader: ProjectResourceLoader;
	constructor(private readonly options: PiBackendOptions = {}) {
		this.packages = new PackageAdmin({ registry: this.registry, defaultCwd: options.defaultCwd });
		this.projectLoader = new ProjectResourceLoader({
			trustStore: this.trustStore,
			ask: (dir, opts) => this.trustGate.ask(dir, opts),
			canAsk: () => this.trustEmitter.size > 0,
			buildExtensions: (cwd, confirm, modeRef) => this.buildExtensionFactories(cwd, confirm, modeRef),
			projectTrust: options.projectTrust,
			desktopIntegration: options.desktopIntegration,

			warmSkillPrefs: async () => {
				await this.skillPrefs.getDisabledNames();
				await this.options.featureGates?.warm();
			},

			getDisabledSkills: (cwd) => {
				const names = new Set(this.skillPrefs.getDisabledNamesSync(this.skillSpace(cwd)));
				for (const name of this.options.featureGates?.get().skills ?? []) names.add(name);

				for (const [name, lang] of Object.entries(LANGUAGE_GATED_SKILLS)) {
					if (lang !== this.chatLanguage) names.add(name);
				}
				return names;
			},
		});
	}

	setUiLanguage(language: TitleLanguage, chatLanguage?: TitleLanguage): void {
		this.uiLanguage = language;
		this.chatLanguage = chatLanguage ?? language;
	}

	private buildCustomTools(gate: PermissionGate, preferBuiltin: boolean): ToolDefinition[] {
		const gatedTools = this.options.featureGates?.get().tools;
		const tools = [...(this.options.customTools ?? [])].filter((tool) => !gatedTools?.has(tool.name));
		const webFetch = this.options.webFetch;
		if (webFetch !== false) {
			tools.push(makeWebFetchTool(typeof webFetch === "object" ? webFetch : undefined));
		}
		tools.push(
			makeAskUserTool({
				askForm: (sessionId, questions) => {
					const host = sessionId ? this.registry.get(sessionId)?.dialogs : undefined;
					if (!host) return Promise.resolve(undefined);
					return host.ask("form", { title: "", questions }) as Promise<string[] | undefined>;
				},
			}),
		);
		tools.push(makeShowImageTool());
		tools.push(makeTodoTool());
		if (preferBuiltin) {
			tools.push(makeSubagentTool(this.makeSubagentDeps(gate)));
		}
		return tools;
	}

	private makeSubagentDeps(gate: PermissionGate): MakeSubagentToolDeps {
		return {
			getModelRuntime: () => this.getModelRuntime(),
			getSubagentModel: (agentName) => this.modelPrefs.getSubagentModel(agentName),
			getSubagentThinkingLevel: (agentName) => this.modelPrefs.getSubagentThinking(agentName),
			gate,
			traces: this.traces,
			onEvent: (sessionId, event) => this.emitEvent(sessionId, event),
			emitUi: (sessionId, event) => this.emitEvent(sessionId, event),
			appendAgentMessage: (sessionId, agent, text, sessionFile) =>
				this.appendAgentMessageToSession(sessionId, agent, text, sessionFile),
			getGroupContext: (sessionId) => this.buildGroupContext(sessionId),
		};
	}

	private async subagentPreferBuiltin(): Promise<boolean> {
		return resolveSubagentPreferBuiltin(
			this.options.subagentPreferBuiltin,
			await this.modelPrefs.getSubagentPreferBuiltin(),
		);
	}

	private buildExtensionFactories(
		cwd: string,
		confirm: PermissionConfirm | undefined,
		modeRef?: PermissionModeRef,
	): Array<
		| ReturnType<typeof makeTodoReminderExtension>
		| ReturnType<typeof makeChannelWatchExtension>
		| ReturnType<typeof makeEvapExtension>
		| ReturnType<typeof makePtcExtension>
		| ReturnType<typeof makeShotHydrationExtension>
		| ReturnType<typeof makeReplyLanguageExtension>
		| ReturnType<typeof makeMainAgentPersonaExtension>
	> {
		const factories: Array<
			| ReturnType<typeof makeTodoReminderExtension>
			| ReturnType<typeof makeChannelWatchExtension>
			| ReturnType<typeof makeEvapExtension>
			| ReturnType<typeof makePtcExtension>
			| ReturnType<typeof makeShotHydrationExtension>
			| ReturnType<typeof makeReplyLanguageExtension>
			| ReturnType<typeof makeMainAgentPersonaExtension>
		> = [];

		const permissionOptions = {
			projectRoot: cwd,
			confirm,
			getMode: () => modeRef?.current ?? "default",
		};
		const evaluator =
			this.options.permissionGates !== false && this.options.permissionExtension !== false
				? createPermissionEvaluator(getAgentDir(), permissionOptions)
				: undefined;
		if (evaluator) {
			factories.push(makePermissionGateExtension(getAgentDir(), { ...permissionOptions, evaluator }));
		}

		factories.push(
			makeEvapExtension({
				agentDir: getAgentDir(),
				reporter: (sessionId, batch) => {
					reportEvapBatch(sessionId, batch);
					this.traces.recordCustom(sessionId, "evap_batch", batch);
				},
			}),
		);

		factories.push(makeShotHydrationExtension());

		factories.push(
			makeChannelWatchExtension({
				agentDir: getAgentDir(),
				cwd,
				onSubscriptionsChanged: (sessionId, topics) => {
					const current = this.registry.get(sessionId);
					if (!current || current.modeRef === modeRef) this.reportChannelSubscriptions(sessionId, topics);
				},
				waitForHistoryReady: (sessionId) => this.historyGate.wait(sessionId),
				isSessionAlive: (sessionId) =>
					modeRef !== undefined && this.registry.get(sessionId)?.modeRef === modeRef,
				onSessionCleanup: (cleanup) => {
					if (modeRef) this.channelWatchCleanups.set(modeRef, cleanup);
				},
			}),
		);

		factories.push(
			makePtcExtension({
				evaluator,
				resolveTool: (sessionId, name) =>
					sessionId ? this.registry.get(sessionId)?.session.getToolDefinition(name) : undefined,
				onDispatch: (sessionId, info) => {
					if (sessionId) this.traces.recordCustom(sessionId, "ptc_dispatch", info);
				},

				onSubCall: (sessionId, event) => {
					if (sessionId) this.emitEvent(sessionId, event);
				},
			}),
		);

		factories.push(makeReplyLanguageExtension(() => this.chatLanguage));

		factories.push(
			makeMainAgentPersonaExtension(
				() => this.modelPrefs.getMainAgentPrompt(),
				() => this.modelPrefs.getMainAgentName(),
			),
		);

		factories.push(makeTodoReminderExtension());
		return factories;
	}

	private async bindSessionExtensions(
		session: AgentSession,
		sessionId: string,
	): Promise<ExtensionDialogHost> {
		const dialogs = new ExtensionDialogHost({
			onRequest: (req) => this.extensionDialogRequestEmitter.emit(req),
			onResolved: (result) => this.extensionDialogResolvedEmitter.emit(result),
		});
		dialogs.bind(sessionId);
		const recordExtensionError = (err: ExtensionError): void => {
			log.error("extension error", sessionId, err);
			try {
				this.traces.recordCustom(sessionId, "extension_error", {
					path: err.extensionPath,
					event: err.event,
					error: err.error,
				});
			} catch {}
		};
		await session.bindExtensions({
			uiContext: makeUiContext({
				dialogs,
				onNotify: (message, level, source) =>
					this.extensionNotifyEmitter.emit({ sessionId, extensionPath: source, message, level }),
				onEditorText: (text, source) => this.extensionEditorTextEmitter.emit({ sessionId, text, source }),
			}),
			mode: "rpc",
			onError: recordExtensionError,
		});
		return dialogs;
	}

	async setPluginProviders(raw: unknown): Promise<void> {
		this.pluginProvidersRaw = raw;
		const specs = parseManagedProviders(raw);
		if (!this.modelRuntime && specs.length === 0) {
			this.pluginProviderIds.clear();
			return;
		}
		const runtime = await this.getModelRuntime();
		this.applyPluginProviders(runtime, specs);
	}

	private applyPluginProviders(runtime: ModelRuntime, specs?: ManagedProviderSpec[]): void {
		const list = specs ?? parseManagedProviders(this.pluginProvidersRaw);
		const next = new Set<string>();
		for (const raw of list) {
			try {
				const collision = this.builtinProviderIds.has(raw.id) && !this.pluginProviderIds.has(raw.id);
				const spec = collision ? { ...raw, id: `plugin-${raw.id}` } : raw;
				runtime.registerNativeProvider(
					buildManagedProvider(spec),
				);
				next.add(spec.id);
			} catch (error) {
				log.warn("插件供应商注册失败", { id: raw.id, error: (error as Error).message });
			}
		}
		for (const id of this.pluginProviderIds) {
			if (!next.has(id)) {
				try {
					runtime.unregisterProvider(id);
				} catch {}
			}
		}
		this.pluginProviderIds = next;
	}

	private async getModelRuntime(): Promise<ModelRuntime> {
		if (this.modelRuntime) return this.modelRuntime;
		if (!this.modelPromise) {
			this.modelPromise = ModelRuntime.create();
		}
		this.modelRuntime = await this.modelPromise;

		if (this.pluginProvidersRaw !== null) this.applyPluginProviders(this.modelRuntime);
		return this.modelRuntime;
	}

	private scheduleAiTitle(session: AgentSession, readOnly: boolean | undefined, triggerText?: string): void {
		const state = this.aiTitleState.get(session);
		if (state?.status === "in-flight") {
			if (triggerText) state.userTexts.push(triggerText);
			return;
		}
		if (!triggerText) {
			if (state) return;

			const firstText = firstUserMessageText(session.sessionManager.getBranch());
			const expectedName = session.sessionName;
			if (!shouldTitleWithAi({ readOnly, messageText: firstText, currentName: expectedName })) return;
			if (!firstText) return;
			this.startAiTitle(session, userMessageTexts(session.sessionManager.getBranch()), expectedName);
			return;
		}
		if (!state) {
			const expectedName = session.sessionName;
			if (!shouldTitleWithAi({ readOnly, messageText: triggerText, currentName: expectedName })) return;
			this.startAiTitle(session, [triggerText], expectedName);
			return;
		}

		state.userTexts.push(triggerText);
		if (
			!shouldTitleAgain({
				readOnly,
				state,
				currentName: session.sessionName,
			})
		)
			return;
		this.startAiTitle(session, state.userTexts, state.expectedName);
	}

	private startAiTitle(session: AgentSession, userTexts: string[], expectedName: string | undefined): void {
		const attempts = (this.aiTitleState.get(session)?.attempts ?? 0) + 1;
		this.aiTitleState.set(session, { status: "in-flight", userTexts, expectedName, attempts });
		void this.runAiTitle(session, composeTitleInput(userTexts), expectedName, attempts);
	}

	private async completeTitleRequest(
		model: Model<any>,
		request: { systemPrompt: string; prompt: string },
		signal: AbortSignal,
	): Promise<AssistantMessage> {
		const runtime = await this.getModelRuntime();
		const stream = runtime.streamSimple(
			model,
			{
				systemPrompt: request.systemPrompt,
				messages: [{ role: "user", content: request.prompt, timestamp: Date.now() }],
			},
			{ signal },
		);
		let streamedText = "";
		for await (const event of stream) {
			if (event.type === "text_delta") streamedText += event.delta;
		}
		const message = await stream.result();
		if (message.stopReason === "error" || message.stopReason === "aborted") {
			throw new Error(message.errorMessage ?? `ai title request ${message.stopReason}`);
		}
		return repairMessageText(message, streamedText);
	}

	private async runAiTitle(
		session: AgentSession,
		messageText: string,
		expectedName: string | undefined,
		attempts: number,
	): Promise<void> {
		const sessionId = session.sessionId;

		const model = session.model;

		const settle = (status: "done" | "failed", writtenTitle?: string): void => {
			const state = this.aiTitleState.get(session);

			if (state && state.status === "in-flight" && state.attempts === attempts) {
				if (writtenTitle !== undefined) state.expectedName = writtenTitle;
				state.status = status;
			}
		};
		try {
			if (!model) {
				settle("failed");
				return;
			}
			const title = await generateAiTitle(model, messageText, this.uiLanguage, {
				complete: (target, request, signal) => this.completeTitleRequest(target, request, signal),
			});
			if (!title) {
				settle("failed");
				return;
			}
			const written = applyAiTitle({
				session,
				expectedName,
				title,
				isAlive: () => this.registry.has(sessionId),
			});
			settle("done", written ? title : undefined);
			if (written)
				log.info("session ai titled", sessionId, { title, model: `${model.provider}/${model.id}` });
		} catch (error) {
			log.warn("session ai title failed", sessionId, {
				attempt: attempts,
				model: model ? `${model.provider}/${model.id}` : undefined,
				error: error instanceof Error ? error.message : String(error),
			});
			settle("failed");
		}
	}

	private appendAgentMessageToSession(
		sessionId: string,
		agent: string,
		text: string,
		sessionFile?: string,
	): void {
		const entry = this.registry.get(sessionId);
		if (!entry) return;
		try {
			entry.session.sessionManager.appendCustomEntry(AGENT_MESSAGE_CUSTOM_TYPE, {
				agent,
				text,
				at: Date.now(),
				...(sessionFile ? { sessionFile } : {}),
			});
		} catch (error) {
			log.warn("append agent message failed", sessionId, String(error));
		}
	}

	private async buildGroupContext(sessionId: string): Promise<string> {
		const entry = this.registry.get(sessionId);
		if (!entry) return "";
		let messages: SessionMessage[];
		try {
			messages = toBranchSessionMessages(entry.session.sessionManager.getBranch());
		} catch {
			return "";
		}
		const mainName = (await this.modelPrefs.getMainAgentName())?.trim() || "主智能体";
		const clip = (s: string): string => {
			const one = s.replace(/\s+/g, " ").trim();
			return one.length > 200 ? `${one.slice(0, 200)}…` : one;
		};
		const lines: string[] = [];
		for (const m of messages) {
			if (m.role === "user" && m.text.trim()) lines.push(`用户：${clip(m.text)}`);
			else if (m.role === "assistant" && m.text.trim()) lines.push(`${mainName}：${clip(m.text)}`);
			else if (m.role === "agent" && m.text.trim()) lines.push(`${m.agent}：${clip(m.text)}`);
		}
		const recent = lines.slice(-14);
		if (recent.length === 0) return "";
		return `【群聊上下文】（最近 ${recent.length} 条，你也在群里，看得到大家说的话；轮到你时接住话头再回应）\n${recent.join("\n")}`;
	}

	private emitEvent(sessionId: string, event: SessionEvent): void {
		this.eventRates.tick(sessionId);

		if (event.type === "session_info_changed") log.info("session renamed", sessionId, { name: event.name });

		if (event.type === "message_update") event = slimMessageUpdate(event);

		event = slimBulkyEvent(event);

		const verdict = this.streamGuard.inspect(sessionId, event);
		if (verdict !== "pass") {
			if (verdict !== "suppress") {
				log.error("stream guard tripped, aborting session", sessionId, { verdict });
				void this.abort(sessionId).catch(() => {});

				this.eventEmitter.emit({ sessionId, event: { type: "stream_guard_tripped", verdict } });
			}
			return;
		}

		if (
			event.type !== "subagent_mutex" &&
			event.type !== "stream_guard_tripped" &&
			event.type !== "ptc_subcall" &&
			event.type !== "agent_say"
		)
			this.traces.record(sessionId, event);
		this.eventEmitter.emit({ sessionId, event });
	}
	async init(): Promise<void> {
		await this.getModelRuntime();
	}
	async createSession(options: CreateSessionOptions): Promise<SessionMeta> {
		const runtime = await this.getModelRuntime();
		const cwd = options.cwd || this.options.defaultCwd || process.cwd();
		const model =
			options.provider && options.modelId ? runtime.getModel(options.provider, options.modelId) : undefined;
		const session = await this.wireSession(cwd, undefined, async (deps) => {
			const { settingsManager, resourceLoader } = await deps.load();
			return createAgentSession({
				cwd,
				modelRuntime: runtime,
				model,

				thinkingLevel: toSdkThinkingLevel(options.thinkingLevel) as ThinkingLevel | undefined,
				tools: this.options.tools,
				customTools: this.buildCustomTools(deps.gate, deps.preferBuiltin),
				sessionManager: SessionManager.create(cwd),
				settingsManager,
				resourceLoader,
			});
		});
		log.info("session created", session.sessionId, { cwd });
		return this.toMetaOrThrow(session.sessionId);
	}

	async openSession(filePath: string): Promise<SessionMeta> {
		const key = resolve(filePath);
		return this.openFlights.run(key, () => this.openSessionOnce(key));
	}
	private async openSessionOnce(filePath: string): Promise<SessionMeta> {
		const sessionManager = SessionManager.open(filePath);
		const existing = this.registry.get(sessionManager.getSessionId());
		if (existing) {
			log.info("session open short-circuited", sessionManager.getSessionId(), { file: filePath });
			return this.registry.toMeta(existing);
		}
		const runtime = await this.getModelRuntime();
		const cwd = sessionManager.getCwd() || process.cwd();
		const readOnly = isSubagentSessionPath(filePath);
		const session = await this.wireSession(cwd, readOnly, async (deps) => {
			const { settingsManager, resourceLoader } = await deps.load();
			return createAgentSession({
				sessionManager,
				modelRuntime: runtime,

				tools: this.options.tools,
				settingsManager,
				resourceLoader,
				customTools: this.buildCustomTools(deps.gate, deps.preferBuiltin),
			});
		});
		log.info("session opened", session.sessionId, { file: filePath });

		this.scheduleAiTitle(session, readOnly);
		return this.toMetaOrThrow(session.sessionId);
	}

	private async wireSession(
		cwd: string,
		readOnly: boolean | undefined,
		makeSession: (deps: {
			gate: PermissionGate;
			preferBuiltin: boolean;

			load: () => Promise<{ settingsManager: SettingsManager; resourceLoader: DefaultResourceLoader }>;
		}) => Promise<CreateAgentSessionResult>,
	): Promise<AgentSession> {
		const gate = new PermissionGate((req) => this.permissionEmitter.emit(req));

		const confirmBridge: PermissionConfirm = (title, message, meta) => gate.confirm(title, message, meta);

		const modeRef: PermissionModeRef = { current: "default" };
		let loaded: { settingsManager: SettingsManager; resourceLoader: DefaultResourceLoader } | undefined;
		const load = async () => {
			loaded ??= await this.projectLoader.load(cwd, { confirm: confirmBridge, modeRef });
			return loaded;
		};
		const preferBuiltin = await this.subagentPreferBuiltin();
		const { session, extensionsResult } = await makeSession({ gate, preferBuiltin, load });
		const mutex = applySubagentMutex(session, extensionsResult, preferBuiltin);
		if (mutex.shadowed.length > 0) {
			log.info("third-party subagent tools shadowed", session.sessionId, mutex);
			for (const shadowed of mutex.shadowed) {
				this.emitEvent(session.sessionId, {
					type: "subagent_mutex",
					extensionPath: shadowed.extensionPath,
					tools: shadowed.tools,
				});
			}
		}
		gate.bindSession(session.sessionId);
		const dialogs = await this.bindSessionExtensions(session, session.sessionId);
		const unsubscribe = session.subscribe((event) => {
			autoNameSession(session, event);

			this.scheduleAiTitle(session, readOnly, messageStartText(event));
			this.emitEvent(session.sessionId, event);
		});
		try {
			this.registry.add({
				session,
				unsubscribe,
				cwd,
				gate,
				dialogs,
				modeRef,
				readOnly: readOnly || undefined,
			});
		} catch (error) {
			this.channelWatchCleanups.get(modeRef)?.();
			this.channelWatchCleanups.delete(modeRef);

			unsubscribe();
			gate.dispose();
			dialogs.dispose();
			session.dispose();
			log.error("session register conflicted; constructed instance disposed", {
				sessionId: session.sessionId,
			});
			throw error;
		}
		if (!readOnly) await this.traces.start(session.sessionId, session.sessionManager.getSessionDir());
		return session;
	}

	async listAllSessions(): Promise<SessionMeta[]> {
		const activeIds = this.activeSessionIds();
		return (await SessionManager.listAll())
			.filter((info) => info.cwd)
			.map((info) =>
				sessionInfoToMeta(info, {
					cwdFallback: "",
					active: activeIds.has(info.id),

					readOnly: isSubagentSessionPath(info.path) || undefined,
				}),
			);
	}
	private activeSessionIds(): Set<string> {
		return new Set(this.registry.list().map((e) => e.session.sessionId));
	}

	reportChannelSubscriptions(sessionId: string, topics: ReadonlySet<string>): void {
		if (topics.size === 0) this.channelSubscriptionIds.delete(sessionId);
		else this.channelSubscriptionIds.set(sessionId, new Set(topics));
	}

	getChannelSubscriptionSessionIds(): string[] {
		return [...this.channelSubscriptionIds.keys()].filter((id) => this.registry.has(id));
	}

	async closeSession(sessionId: string, intent: SessionCloseIntent = "user"): Promise<{ closed: boolean }> {
		const entry = this.registry.get(sessionId);

		if (!entry) return { closed: true };
		if (entry.session.isStreaming) {
			log.warn("closeSession ignored: streaming", sessionId);
			return { closed: false };
		}

		if (intent === "gc" && this.channelSubscriptionIds.has(sessionId)) {
			log.info("closeSession ignored: channel subscriptions", sessionId);
			return { closed: false };
		}
		await this.disposeSession(entry);
		return { closed: true };
	}

	private async disposeSession(entry: RegisteredSession): Promise<void> {
		const sessionId = entry.session.sessionId;
		this.channelWatchCleanups.get(entry.modeRef)?.();
		this.channelWatchCleanups.delete(entry.modeRef);
		entry.session.dispose();
		this.historyGate.cancel(sessionId);

		this.registry.delete(sessionId);

		this.channelSubscriptionIds.delete(sessionId);

		this.streamGuard.cleanup(sessionId);
		this.eventRates.delete(sessionId);
		await this.traces.stop(sessionId);
		log.info("session closed", sessionId);
	}

	async deleteSession(sessionId: string, sessionFile?: string): Promise<void> {
		const entry = this.registry.get(sessionId);
		const sessionDir = entry?.session.sessionManager.getSessionDir();
		const file = sessionFile ?? entry?.session.sessionManager.getSessionFile();

		if (entry) await this.disposeSession(entry);
		if (!file) throw new Error(`Session file not found: ${sessionId}`);

		await unlink(file).catch((error: NodeJS.ErrnoException) => {
			if (error.code !== "ENOENT") throw error;
		});
		if (sessionDir) await TraceRecorder.removeAll(sessionDir, sessionId);
		log.info("session deleted", sessionId);
	}
	async prompt(sessionId: string, text: string, images?: ImageInput[]): Promise<void> {
		const entry = this.requireWritable(sessionId);
		log.info("prompt", sessionId, { text: text.slice(0, 120), images: images?.length ?? 0 });

		await new Promise<void>((resolve, reject) => {
			entry.session
				.prompt(text, {
					streamingBehavior: "followUp",
					images: images?.map((image) => ({
						type: "image" as const,
						data: image.data,
						mimeType: image.mimeType,
					})),
					preflightResult: (ok) => {
						if (ok) resolve();
					},
				})
				.then(
					() => resolve(),
					(err) => reject(err),
				);
		});
	}
	async abort(sessionId: string): Promise<void> {
		const entry = this.registry.get(sessionId);
		if (!entry) return;
		log.info("abort", sessionId);
		await entry.session.abort();
	}

	checkSessionWritable(sessionId: string): "ok" | "not_found" | "read_only" {
		const entry = this.registry.get(sessionId);
		if (!entry) return "not_found";
		if (entry.readOnly) return "read_only";
		return "ok";
	}

	async clearQueue(sessionId: string): Promise<{ steering: string[]; followUp: string[] }> {
		const entry = this.registry.get(sessionId);
		if (!entry) return { steering: [], followUp: [] };
		log.info("clearQueue", sessionId);
		return entry.session.clearQueue();
	}

	async getFollowUpMessages(sessionId: string): Promise<string[]> {
		const entry = this.registry.get(sessionId);
		if (!entry) return [];
		return [...entry.session.getFollowUpMessages()];
	}

	async setModel(sessionId: string, provider: string, modelId: string): Promise<string> {
		const entry = this.requireWritable(sessionId);
		const runtime = await this.getModelRuntime();
		const model = runtime.getModel(provider, modelId);
		if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
		await entry.session.setModel(model);
		this.syncManagedContextWindow(entry.session);
		return entry.session.thinkingLevel;
	}

	private syncManagedContextWindow(session: AgentSession): number | undefined {
		const model = session.model;
		if (!model) return undefined;
		const window = managedContextWindow(model.provider, model.id, session.thinkingLevel);
		if (!window) return undefined;
		if (model.contextWindow !== window) session.state.model = { ...model, contextWindow: window };
		return window;
	}

	async setThinkingLevel(sessionId: string, level: string): Promise<string> {
		const entry = this.requireWritable(sessionId);
		entry.session.setThinkingLevel(toSdkThinkingLevel(level) as ThinkingLevel);
		this.syncManagedContextWindow(entry.session);
		return entry.session.thinkingLevel;
	}
	async compact(sessionId: string, customInstructions?: string): Promise<void> {
		const entry = this.requireWritable(sessionId);
		log.info("compact", sessionId);
		await entry.session.compact(customInstructions);
	}

	async getStats(sessionId: string): Promise<SessionStats> {
		const entry = this.requireSession(sessionId);
		const stats = entry.session.getSessionStats();
		const file = entry.session.sessionManager.getSessionFile();
		let byModel: SessionModelUsage[] = [];
		if (file) {
			try {
				const sig = String(entry.session.sessionManager.getBranch().length);
				const cached = sessionUsageCache.get(sessionId);
				if (cached && cached.sig === sig) {
					byModel = cached.byModel;
				} else {
					byModel = readModelUsageFromContent(await readFile(file, "utf8"));
					sessionUsageCache.set(sessionId, { sig, byModel });
				}
			} catch (error) {
				log.warn("getStats: 按模型聚合失败，回退空分组", String(error));
			}
		}
		return {
			inputTokens: stats.tokens.input,
			outputTokens: stats.tokens.output,
			cacheReadTokens: stats.tokens.cacheRead ?? 0,
			cacheWriteTokens: stats.tokens.cacheWrite ?? 0,
			cost: stats.cost,
			byModel,
		};
	}

	getEventRates(): Map<string, { window60s: number[]; lastEventAt: number }> {
		this.eventRates.prune((id) => this.registry.has(id));
		return this.eventRates.snapshot();
	}

	listActiveSessionRuntime(): { sessionId: string; streaming: boolean; compacting: boolean }[] {
		return this.registry.list().map(({ session }) => ({
			sessionId: session.sessionId,
			streaming: session.isStreaming,
			compacting: session.isCompacting,
		}));
	}

	getPendingPermissionRequests(): PermissionRequest[] {
		return this.registry.list().flatMap(({ gate }) => gate.listPending());
	}

	async getContextUsage(sessionId: string): Promise<ContextUsageInfo | null> {
		const entry = this.requireSession(sessionId);
		const usage = entry.session.getContextUsage();
		if (!usage) return null;
		const contextWindow = this.syncManagedContextWindow(entry.session) ?? usage.contextWindow;
		const percent =
			usage.tokens == null || contextWindow <= 0 ? usage.percent : (usage.tokens / contextWindow) * 100;
		return { tokens: usage.tokens, contextWindow, percent };
	}

	async getQuota(): Promise<QuotaInfo | null> {
		return this.quota.get();
	}

	async listSlashCommands(sessionId: string): Promise<SlashCommandInfo[]> {
		return slashCommandsForSession(this.requireSession(sessionId).session);
	}

	async listSlashCommandsForCwd(cwd?: string): Promise<SlashCommandInfo[]> {
		const target = cwd || this.options.defaultCwd || process.cwd();
		const { resourceLoader } = await this.projectLoader.load(target, { askTrust: false });
		return slashCommandsForLoader(resourceLoader);
	}

	async ensureProjectTrust(cwd: string): Promise<boolean> {
		return this.projectLoader.ensureTrust(cwd);
	}

	private extensionDisplayName(path: string): string {
		const cleaned = path.replace(/\/index\.(ts|js)$/, "");
		const base = cleaned.split("/").filter(Boolean).pop();
		return base ?? path;
	}

	async setSkillModelInvocationDisabled(name: string, disabled: boolean): Promise<SkillPrefs> {
		const prefs = await this.skillPrefs.setModelInvocationDisabled(name, disabled);
		await this.reloadNonStreamingSessions();
		return prefs;
	}

	async createUserSkill(input: { name: string; description: string; content?: string }): Promise<string> {
		return createUserSkill(input);
	}

	async readSkillFile(filePath: string): Promise<string> {
		const resolved = resolve(filePath);
		if (!/\.(md|markdown)$/i.test(resolved)) throw new Error(`not a markdown file: ${filePath}`);
		if (!existsSync(resolved)) throw new Error(`file not found: ${filePath}`);
		return readFile(resolved, "utf8");
	}

	async deleteUserSkill(filePath: string): Promise<void> {
		return deleteUserSkill(filePath);
	}

	private async reloadNonStreamingSessions(): Promise<void> {
		for (const entry of this.registry.list()) {
			if (entry.session.isStreaming || entry.session.isCompacting) {
				log.info("skip skill reload while busy", entry.session.sessionId);
				continue;
			}
			try {
				await entry.session.reload();
			} catch (error) {
				log.warn("session reload failed", entry.session.sessionId, error);
			}
		}
	}

	async getLoadedResources(sessionId: string): Promise<LoadedResources> {
		const entry = this.requireSession(sessionId);
		return this.resourcesFrom(entry.session.resourceLoader, entry.session.sessionManager.getCwd());
	}

	async getLoadedResourcesForCwd(cwd?: string): Promise<LoadedResources> {
		const target = cwd || this.options.defaultCwd || process.cwd();
		const { resourceLoader } = await this.projectLoader.load(target, { askTrust: false });
		return this.resourcesFrom(resourceLoader, target);
	}

	private skillSpace(cwd?: string): SkillSpace {
		const dailyDir = this.options.dailyDir;
		if (!dailyDir || !cwd) return "daily";
		return resolve(cwd) === resolve(dailyDir) ? "daily" : "project";
	}

	private isSystemSkill(skillPath: string, name: string): boolean {
		if (SEEDED_BUILTIN_SKILLS.includes(name)) return true;
		const resolved = resolve(skillPath);
		return (this.options.desktopIntegration?.additionalSkillPaths ?? []).some((dir) => {
			const rel = relative(resolve(dir), resolved);
			return !!rel && !rel.startsWith("..") && !isAbsolute(rel);
		});
	}

	private resourcesFrom(resourceLoader: ResourceLoader, cwd?: string): LoadedResources {
		const skillResult = resourceLoader.getSkills();
		const extResult = resourceLoader.getExtensions();

		const space = this.skillSpace(cwd);
		return {
			skills: skillResult.skills.map((skill) => ({
				name: skill.name,
				description: skill.description,
				scope: skill.sourceInfo.scope,
				source: skill.sourceInfo.source,
				path: skill.filePath,
				disableModelInvocation: skill.disableModelInvocation,

				defaultDisabled:
					skillDefaultsOffIn(space, readChannelWatchEnabled(getAgentDir())).includes(skill.name) || undefined,

				spaceDefaults: SKILL_SPACE_DEFAULTS[skill.name],

				systemSkill: this.isSystemSkill(skill.filePath, skill.name) || undefined,

				tier: skillTierOf(skill.name, this.isSystemSkill(skill.filePath, skill.name)),
			})),
			skillDiagnostics: skillResult.diagnostics.map((d) => ({
				type: d.type,
				message: d.message,
				path: d.path,
			})),
			extensions: extResult.extensions.map((ext) => ({
				name: this.extensionDisplayName(ext.path),
				path: ext.path,
				scope: ext.sourceInfo.scope,
				source: ext.sourceInfo.source,
				hidden: ext.hidden === true,
				toolsCount: ext.tools.size,
				tools: [...ext.tools.keys()],
				commands: [...ext.commands.keys()],
				flagsCount: ext.flags.size,
				shortcutsCount: ext.shortcuts.size,
			})),
			extensionErrors: extResult.errors,
		};
	}

	async setSessionName(sessionId: string, name: string): Promise<void> {
		const entry = this.registry.get(sessionId);
		if (entry) {
			if (entry.readOnly) throw new Error("Session is read-only (subagent transcript)");
			entry.session.setSessionName(name);
			return;
		}

		const meta = (await this.listAllSessions()).find((s) => s.sessionId === sessionId);
		if (!meta) throw new Error(`Session not found: ${sessionId}`);
		if (meta.readOnly) throw new Error("Session is read-only (subagent transcript)");
		if (!meta.sessionFile) throw new Error(`Session has no file: ${sessionId}`);
		renameSessionFile(meta.sessionFile, name);
	}

	async exportSession(sessionId: string, format: "html" | "jsonl"): Promise<string> {
		const entry = this.requireSession(sessionId);
		return format === "html" ? entry.session.exportToHtml() : entry.session.exportToJsonl();
	}

	markSessionHistoryReady(sessionId: string): void {
		if (this.registry.has(sessionId)) this.historyGate.ack(sessionId);
	}

	async getSessionMessages(sessionId: string): Promise<SessionMessage[]> {
		const entry = this.requireSession(sessionId);
		return toBranchSessionMessages(entry.session.sessionManager.getBranch());
	}

	async getSubCallPage(
		sessionId: string,
		toolCallId: string,
		offset: number,
		limit: number,
	): Promise<{ rows: SessionToolCall[]; total: number }> {
		const entry = this.requireSession(sessionId);
		const start = Math.max(0, Math.floor(offset));
		const size = Math.max(1, Math.min(500, Math.floor(limit)));
		for (const raw of entry.session.sessionManager.getBranch() as { message?: unknown }[]) {
			const msg = raw?.message as { role?: string; toolCallId?: string; details?: unknown } | undefined;
			if (msg?.role !== "toolResult" || msg.toolCallId !== toolCallId) continue;
			const rows = runCodeSubCallRows(msg.details) ?? [];
			return { rows: rows.slice(start, start + size), total: rows.length };
		}
		return { rows: [], total: 0 };
	}

	async peekSessionMessages(sessionId: string): Promise<SessionMessage[] | null> {
		if (this.registry.get(sessionId)) return this.getSessionMessages(sessionId);
		const meta = (await this.listAllSessions()).find((s) => s.sessionId === sessionId);
		if (!meta?.sessionFile) return null;
		try {
			const content = await readFile(meta.sessionFile, "utf8");
			return readSessionMessagesFromContent(content);
		} catch {
			return null;
		}
	}

	async getTodos(sessionId: string): Promise<TodoItem[]> {
		const entry = this.requireSession(sessionId);
		for (const raw of [...entry.session.messages].reverse()) {
			const m = raw as RawMessage;
			if (m.role === "toolResult" && m.toolName === TODO_TOOL_NAME && !m.isError) {
				const todos = extractTodos(m.details);
				if (todos) return todos;
			}
			if (m.role === "custom" && m.customType === TODO_REMINDER_CUSTOM_TYPE) {
				const todos = extractTodos(m.details);
				if (todos) return todos;
			}
		}
		return [];
	}

	async forkSession(sessionId: string, ref: { entryId?: string; text?: string }): Promise<SessionMeta> {
		const entry = this.requireWritable(sessionId);
		if (entry.session.isStreaming || entry.session.isCompacting) {
			throw new Error("Cannot fork while the agent is running or context is compacting");
		}
		const sourceManager = entry.session.sessionManager;
		const targetId = resolveForkEntryId(sourceManager, ref);
		const file = sourceManager.getSessionFile();
		if (!file || !existsSync(file)) {
			throw new Error("This session has not been saved yet. Send a message first.");
		}

		const forkedManager = SessionManager.open(file, sourceManager.getSessionDir());
		const newPath = forkedManager.createBranchedSession(targetId);
		if (!newPath) throw new Error("Failed to create forked session");
		log.info("fork session", sessionId, { targetId, newPath });
		return this.openSession(newPath);
	}

	static readonly RECALLED_MARKER_TYPE = "message-recalled";

	async recallMessage(
		sessionId: string,
		ref: { entryId?: string; text?: string; timestamp?: number },
	): Promise<{ text: string; images: ImageInput[] }> {
		const entry = this.requireWritable(sessionId);
		if (entry.session.isStreaming || entry.session.isCompacting) {
			throw new Error("Cannot recall while the agent is running or context is compacting");
		}
		const sm = entry.session.sessionManager;
		const targetId = resolveRecallEntryId(sm, ref);
		const target = sm.getEntry(targetId) as Extract<SessionEntry, { type: "message" }>;
		const message = target.message as RawMessage;

		const sourceText = blockText(message.content);
		const invocation = parseExpandedSkillInvocation(sourceText);
		const text = invocation ? formatSkillCommand(invocation) : sourceText;
		const images = blockImages(message.content);
		if (sm.getLeafId() === targetId) {
			if (target.parentId) sm.branch(target.parentId);
			else sm.resetLeaf();
			entry.session.agent.state.messages = sm.buildSessionContext().messages;
		} else {
			const result = await entry.session.navigateTree(targetId);
			if (result.cancelled) throw new Error("Recall was cancelled by an extension");
		}

		sm.appendCustomEntry(PiBackend.RECALLED_MARKER_TYPE, { recalledEntryId: targetId });
		log.info("recall message", sessionId, { targetId });
		return { text, images };
	}
	async listModels(): Promise<AvailableModel[]> {
		const [providers, prefs, runtime] = await Promise.all([
			this.settings.listProviders(),
			this.modelPrefs.getPrefs(),
			this.getModelRuntime(),
		]);
		return providers.flatMap((provider) =>
			provider.configured
				? provider.models
						.filter((model) => !prefs.hiddenModels[provider.id]?.includes(model.id))
						.map((model) => {
							let thinkingLevels: string[] | undefined;
								let imageInput: boolean | undefined;
								try {
									const m = runtime.getModel(provider.id, model.id);
									if (m) {
										thinkingLevels = getSupportedThinkingLevels(m);
										imageInput = m.input.includes("image");
									}
								} catch {
									thinkingLevels = undefined;
									imageInput = undefined;
								}
								return {
									provider: provider.id,
									providerName: provider.name,
									id: model.id,
									label: model.name,
									authed: true,
									thinkingLevels,
									imageInput,
								};
						})
				: [],
		);
	}
	async listSubagents(): Promise<SubagentInfo[]> {
		const agents = await discoverAgents(this.options.defaultCwd ?? process.cwd(), { projectTrusted: false });
		return agents
			.filter((agent) => agent.source !== "project")
			.map(({ name, description, source, tools, systemPrompt, path, thinking, thinkingWarning }) => ({
				name,
				description,
				source: source === "builtin" ? "builtin" : "user",
				tools,
				systemPrompt,
				...(path ? { path } : {}),
				...(thinking ? { thinking } : {}),
				...(thinkingWarning ? { thinkingWarning } : {}),
			}));
	}

	async saveSubagent(input: {
		name: string;
		originalName?: string;
		description: string;
		systemPrompt: string;
		tools: string[];
	}): Promise<string> {
		const path = await saveUserAgent(input);
		const previous = input.originalName?.trim();
		const name = input.name.trim();
		if (previous && previous !== name) await this.modelPrefs.renameSubagent(previous, name);
		log.info("subagent saved", { name, path });
		return path;
	}

	async deleteSubagent(name: string): Promise<void> {
		await deleteUserAgent(name);
		await this.modelPrefs.forgetSubagent(name);
		log.info("subagent deleted", { name: name.trim() });
	}
	onEvent(handler: (sessionId: string, event: SessionEvent) => void): () => void {
		return this.eventEmitter.subscribe(({ sessionId, event }) => handler(sessionId, event));
	}

	onSessionsChanged(handler: () => void): () => void {
		this.sessionsChangedHandler = handler;
		if (!this.sessionWatcher) {
			const root = getAgentDir();
			this.sessionWatcher = new SessionWatcher([`${root}/sessions`, `${root}/sessions-subagents`], () =>
				this.sessionsChangedHandler?.(),
			);
			this.sessionWatcher.start();
		}
		return () => {
			this.sessionsChangedHandler = null;
		};
	}
	private sessionWatcher: SessionWatcher | null = null;
	private sessionsChangedHandler: (() => void) | null = null;
	onPermissionRequest(handler: (req: PermissionRequest) => void): () => void {
		return this.permissionEmitter.subscribe(handler);
	}

	onPermissionResolved(handler: (result: PermissionResolved) => void): () => void {
		return this.permissionResolvedEmitter.subscribe(handler);
	}
	onTrustRequest(handler: (req: TrustRequest) => void): () => void {
		return this.trustEmitter.subscribe(handler);
	}
	onLoginEvent(handler: (payload: LoginEventPayload) => void): () => void {
		return this.loginEmitter.subscribe(handler);
	}

	onExtensionDialogRequest(handler: (req: ExtensionDialogRequest) => void): () => void {
		return this.extensionDialogRequestEmitter.subscribe(handler);
	}
	onExtensionDialogResolved(handler: (result: ExtensionDialogResolved) => void): () => void {
		return this.extensionDialogResolvedEmitter.subscribe(handler);
	}
	onExtensionNotify(handler: (event: ExtensionNotifyEvent) => void): () => void {
		return this.extensionNotifyEmitter.subscribe(handler);
	}
	onExtensionEditorText(handler: (event: ExtensionEditorTextEvent) => void): () => void {
		return this.extensionEditorTextEmitter.subscribe(handler);
	}

	respondExtensionDialog(requestId: string, answer: ExtensionDialogRespond): void {
		for (const { dialogs } of this.registry.list()) {
			dialogs.respond(requestId, answer);
		}
	}
	respondPermission(requestId: string, answer: PermissionAnswer): void {
		if (answer === "allowDir" || answer === "allowAlways") {
			for (const { gate } of this.registry.list()) {
				const req = gate.getRequest(requestId);
				if (!req) continue;

				gate.respond(requestId, answer);
				this.permissionResolvedEmitter.emit({
					sessionId: gate.getSessionId(),
					requestId,
					answered: true,
				});
				const entry = this.registry.get(gate.getSessionId());
				if (entry) {
					try {
						const agentDir = getAgentDir();
						if (answer === "allowDir" && req.meta?.suggestDir) {
							addWorkspaceRoot(agentDir, entry.cwd, req.meta.suggestDir);
						} else if (answer === "allowAlways" && req.meta) {
							addAllowedPattern(agentDir, entry.cwd, req.title);
						}
					} catch (err) {
						log.error("权限决策持久化失败（agent 已放行，本次决策不记忆）", requestId, err);
					}
				}
				return;
			}
			return;
		}
		for (const { gate } of this.registry.list()) {
			if (!gate.getRequest(requestId)) continue;
			gate.respond(requestId, answer);
			this.permissionResolvedEmitter.emit({
				sessionId: gate.getSessionId(),
				requestId,
				answered: true,
			});
		}
	}

	getPermissionConfig(): { enabled: boolean } {
		return { enabled: loadPermissionConfig(getAgentDir()).enabled };
	}

	getSessionPermissionMode(sessionId: string): PermissionMode {
		return this.registry.get(sessionId)?.modeRef.current ?? "default";
	}

	setSessionPermissionMode(sessionId: string, mode: PermissionMode): void {
		const entry = this.registry.get(sessionId);
		if (!entry) throw new Error(`Session not found: ${sessionId}`);
		entry.modeRef.current = mode;
		log.info("permission mode", sessionId, { mode });
	}

	getContextManagerConfig(): { mode: ContextManagerMode } {
		return { mode: readContextManagerMode(getAgentDir()) };
	}

	setContextManagerMode(mode: ContextManagerMode): void {
		try {
			writeContextManagerMode(getAgentDir(), mode);
		} catch (err) {
			log.error("settings.json 写入失败（contextManager mode 未保存）", err);
			throw err;
		}
		log.info("context manager mode", mode);
	}

	getChannelWatchConfig(): { enabled: boolean } {
		return { enabled: readChannelWatchEnabled(getAgentDir()) };
	}

	setChannelWatchEnabled(enabled: boolean): void {
		try {
			writeChannelWatchEnabled(getAgentDir(), enabled);
		} catch (err) {
			log.error("settings.json 写入失败（channel-watch 开关未保存）", err);
			throw err;
		}
		log.info("channel watch enabled", enabled);
	}

	respondTrust(requestId: string, answer: TrustAnswer): void {
		this.trustGate.respond(requestId, answer);
	}
	dispose(): void {
		for (const entry of this.registry.list()) this.channelWatchCleanups.get(entry.modeRef)?.();
		this.registry.disposeAll();
		this.historyGate.dispose();
		this.eventEmitter.clear();
		this.permissionEmitter.clear();
		this.permissionResolvedEmitter.clear();
		this.trustEmitter.clear();
		this.loginEmitter.clear();
		this.extensionDialogRequestEmitter.clear();
		this.extensionDialogResolvedEmitter.clear();
		this.extensionNotifyEmitter.clear();
		this.extensionEditorTextEmitter.clear();
		this.trustGate.dispose();
		this.traces.disposeAll();
		log.info("backend disposed");
	}
	private requireSession(sessionId: string) {
		const entry = this.registry.get(sessionId);
		if (!entry) throw new Error(`Session not found: ${sessionId}`);
		return entry;
	}

	private requireWritable(sessionId: string) {
		const entry = this.requireSession(sessionId);
		if (entry.readOnly) throw new Error("Session is read-only (subagent transcript)");
		return entry;
	}
	private toMetaOrThrow(sessionId: string): SessionMeta {
		const entry = this.registry.get(sessionId);
		if (!entry) throw new Error(`Session not found: ${sessionId}`);
		return this.registry.toMeta(entry);
	}
}
export type { EventForwarder, Model };
