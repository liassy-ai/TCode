import type {
	ContextManagerMode,
	CustomProviderInput,
	CustomProviderUpdateInput,
	LoadedExtension,
	LoadedSkill,
	ModelPrefs,
	ProviderInfo,
	ProviderTestResult,
	ResourceDiagnosticInfo,
	SkillPrefs,
	SubagentInfo,
	WebAccessScope,
	WebAccessStatus,
} from "@tcode/shared";
import { create } from "zustand";
import { getPi } from "../api";
import { useSessionsStore } from "./sessions";

export type SettingsCategory =
	| "general"
	| "appearance"
	| "models"
	| "skills"
	| "extensions"
	| "web"
	| "archive"
	| "update"
	| "bug"
	| "about"
	| `plugin:${string}`;

interface SettingsStore {
	open: boolean;

	generalTabHint: string | null;
	setGeneralTabHint: (tab: string | null) => void;

	category: SettingsCategory;
	providers: ProviderInfo[];

	modelPrefs: ModelPrefs | null;
	subagents: SubagentInfo[];
	loading: boolean;

	permissionGateOff: boolean | null;

	contextManagerMode: ContextManagerMode | null;

	channelWatchEnabled: boolean | null;

	webAccessStatus: WebAccessStatus | null;
	webAccessSaving: boolean;

	skills: LoadedSkill[] | null;
	skillDiagnostics: ResourceDiagnosticInfo[];

	skillPrefs: SkillPrefs | null;

	extensions: LoadedExtension[] | null;
	extensionErrors: { path: string; error: string }[];

	testResults: Record<string, ProviderTestResult | "testing">;
	error: string | null;
	setOpen: (open: boolean) => void;

	openWith: (category?: SettingsCategory) => void;
	setCategory: (category: SettingsCategory) => void;
	refresh: () => Promise<void>;
	removeCredential: (providerId: string) => Promise<void>;
	addCustom: (input: CustomProviderInput) => Promise<void>;
	updateCustom: (input: CustomProviderUpdateInput) => Promise<void>;
	removeCustom: (providerId: string) => Promise<void>;

	setProviderBaseUrl: (providerId: string, baseUrl: string, apiKey?: string) => Promise<void>;
	test: (providerId: string) => Promise<void>;
	setModelHidden: (provider: string, modelId: string, hidden: boolean) => Promise<void>;
	setModelsHidden: (provider: string, modelIds: string[], hidden: boolean) => Promise<void>;
	setSubagentModel: (agent: string, modelRef: string | null) => Promise<void>;

	setSubagentThinking: (agent: string, level: string | null) => Promise<void>;

	setSubagentPreferBuiltin: (enabled: boolean) => Promise<void>;

	setMainAgentPrompt: (prompt: string | null) => Promise<void>;
	setMainAgentName: (name: string | null) => Promise<void>;

	refreshSubagents: () => Promise<void>;

	saveSubagent: (input: {
		name: string;
		originalName?: string;
		description: string;
		systemPrompt: string;
		tools: string[];
	}) => Promise<string>;

	deleteSubagent: (name: string) => Promise<void>;

	setSkillModelInvocationDisabled: (name: string, disabled: boolean) => Promise<void>;

	createUserSkill: (input: { name: string; description: string; content?: string }) => Promise<string>;

	refreshResources: () => Promise<void>;
	setContextManagerMode: (mode: ContextManagerMode) => Promise<void>;
	setChannelWatchEnabled: (enabled: boolean) => Promise<void>;
	refreshWebAccessStatus: () => Promise<void>;

	setWebAccessEnabled: (enabled: boolean, port?: number) => Promise<void>;

	setWebAccessScope: (scope: WebAccessScope) => Promise<void>;

	regenerateWebAccessToken: () => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => {
	const afterMutation = async () => {
		await get().refresh();
		await useSessionsStore.getState().loadModels();
	};

	const confirmAfterRestart = async (
		match: (status: WebAccessStatus) => boolean,
	): Promise<WebAccessStatus | null> => {
		await new Promise((r) => setTimeout(r, 2000));
		for (let i = 0; i < 3; i++) {
			try {
				const status = await getPi().webAccessGetStatus();
				return match(status) ? status : null;
			} catch {
				await new Promise((r) => setTimeout(r, 1500));
			}
		}
		return null;
	};

	return {
		open: false,
		generalTabHint: null,
		category: "models",
		providers: [],
		modelPrefs: null,
		subagents: [],
		loading: false,
		permissionGateOff: null,
		contextManagerMode: null,
		channelWatchEnabled: null,
		webAccessStatus: null,
		webAccessSaving: false,
		skills: null,
		skillDiagnostics: [],
		skillPrefs: null,
		extensions: null,
		extensionErrors: [],
		testResults: {},
		error: null,

		setGeneralTabHint: (tab) => set({ generalTabHint: tab }),
		setOpen: (open) => {
			set({ open, testResults: {}, error: null });
			if (open) void get().refresh();
		},

		openWith: (category) => {
			set((state) => ({ category: category ?? state.category, open: true, testResults: {}, error: null }));
			void get().refresh();
		},

		setCategory: (category) => set({ category }),

		refresh: async () => {
			set({ loading: true });

			void getPi()
				.getPermissionConfig()
				.then((permission) => set({ permissionGateOff: !permission.enabled }))
				.catch(() => {});

			void getPi()
				.getContextManagerConfig()
				.then((cm) => set({ contextManagerMode: cm.mode }))
				.catch(() => {});

			void getPi()
				.getChannelWatchConfig()
				.then((cw) => set({ channelWatchEnabled: cw.enabled }))
				.catch(() => {});

			void getPi()
				.webAccessGetStatus()
				.then((webAccessStatus) => set({ webAccessStatus }))
				.catch(() => {});
			try {
				const [providers, modelPrefs, subagents, skillPrefs] = await Promise.all([
					getPi().listProviders({}),
					getPi().getModelPrefs(),
					getPi().listSubagents(),
					getPi().getSkillPrefs(),
				]);
				set({ providers, modelPrefs, subagents, skillPrefs, loading: false, error: null });
				await get().refreshResources();
			} catch (error) {
				set({ loading: false, error: error instanceof Error ? error.message : String(error) });
			}
		},

		refreshResources: async () => {
			try {
				const activeSessionId = useSessionsStore.getState().activeSessionId;
				if (activeSessionId) {
					const resources = await getPi().getLoadedResources({ sessionId: activeSessionId });

					if (useSessionsStore.getState().activeSessionId === activeSessionId) {
						set({
							skills: resources.skills,
							skillDiagnostics: resources.skillDiagnostics,
							extensions: resources.extensions,
							extensionErrors: resources.extensionErrors,
						});
					}
				} else {
					const draftCwd = useSessionsStore.getState().cwd;
					const resources = await getPi().getLoadedResourcesForCwd({ cwd: draftCwd ?? undefined });

					if (
						useSessionsStore.getState().activeSessionId === null &&
						useSessionsStore.getState().cwd === draftCwd
					) {
						set({
							skills: resources.skills,
							skillDiagnostics: resources.skillDiagnostics,
							extensions: resources.extensions,
							extensionErrors: resources.extensionErrors,
						});
					}
				}
			} catch {}
		},

		createUserSkill: async (input) => {
			const path = await getPi().createUserSkill(input);
			await get().refreshResources();
			return path;
		},

		setContextManagerMode: async (mode) => {
			const previous = get().contextManagerMode;
			set({ contextManagerMode: mode });
			try {
				await getPi().setContextManagerMode({ mode });
			} catch (error) {
				set({
					contextManagerMode: previous,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		},

		setChannelWatchEnabled: async (enabled) => {
			const previous = get().channelWatchEnabled;
			set({ channelWatchEnabled: enabled });
			try {
				await getPi().setChannelWatchEnabled({ enabled });
			} catch (error) {
				set({
					channelWatchEnabled: previous,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		},

		refreshWebAccessStatus: async () => {
			try {
				set({ webAccessStatus: await getPi().webAccessGetStatus() });
			} catch (error) {
				set({ error: error instanceof Error ? error.message : String(error) });
			}
		},

		setWebAccessEnabled: async (enabled, port) => {
			set({ webAccessSaving: true });
			try {
				const webAccessStatus = await getPi().webAccessSetEnabled({ enabled, port });
				set({ webAccessStatus, webAccessSaving: false });
			} catch (error) {
				const webAccessStatus = await confirmAfterRestart(
					(status) => status.enabled === enabled && (port === undefined || !enabled || status.port === port),
				);
				if (webAccessStatus) {
					set({ webAccessStatus, webAccessSaving: false });
					return;
				}
				set({ webAccessSaving: false, error: error instanceof Error ? error.message : String(error) });
			}
		},

		setWebAccessScope: async (scope) => {
			set({ webAccessSaving: true });
			try {
				const webAccessStatus = await getPi().webAccessSetScope({ scope });
				set({ webAccessStatus, webAccessSaving: false });
			} catch (error) {
				const webAccessStatus = await confirmAfterRestart((status) => status.scope === scope);
				if (webAccessStatus) {
					set({ webAccessStatus, webAccessSaving: false });
					return;
				}
				set({ webAccessSaving: false, error: error instanceof Error ? error.message : String(error) });
			}
		},

		regenerateWebAccessToken: async () => {
			set({ webAccessSaving: true });
			try {
				const webAccessStatus = await getPi().webAccessRegenerateToken();
				set({ webAccessStatus, webAccessSaving: false });
			} catch (error) {
				set({ webAccessSaving: false, error: error instanceof Error ? error.message : String(error) });
			}
		},

		removeCredential: async (providerId) => {
			try {
				await getPi().removeCredential({ providerId });
				await afterMutation();
			} catch (error) {
				set({ error: error instanceof Error ? error.message : String(error) });
			}
		},

		addCustom: async (input) => {
			try {
				await getPi().addCustomProvider({ input });
				await afterMutation();
			} catch (error) {
				set({ error: error instanceof Error ? error.message : String(error) });
				throw error;
			}
		},

		updateCustom: async (input) => {
			try {
				await getPi().updateCustomProvider({ input });
				await afterMutation();
			} catch (error) {
				set({ error: error instanceof Error ? error.message : String(error) });
				throw error;
			}
		},

		removeCustom: async (providerId) => {
			try {
				await getPi().removeCustomProvider({ providerId });
				await afterMutation();
			} catch (error) {
				set({ error: error instanceof Error ? error.message : String(error) });
			}
		},

		setProviderBaseUrl: async (providerId, baseUrl, apiKey) => {
			try {
				await getPi().setProviderBaseUrl({ providerId, baseUrl, apiKey });
				await afterMutation();
			} catch (error) {
				set({ error: error instanceof Error ? error.message : String(error) });
				throw error;
			}
		},

		setModelHidden: async (provider, modelId, hidden) => {
			const previous = get().modelPrefs;
			const base: ModelPrefs = previous ?? { hiddenModels: {}, subagentModels: {} };
			const ids = new Set(base.hiddenModels[provider] ?? []);
			if (hidden) ids.add(modelId);
			else ids.delete(modelId);
			const hiddenModels = { ...base.hiddenModels };
			if (ids.size) hiddenModels[provider] = [...ids];
			else delete hiddenModels[provider];

			set({ modelPrefs: { ...base, hiddenModels } });
			try {
				await getPi().setModelHidden({ provider, modelId, hidden });
				await useSessionsStore.getState().loadModels();
			} catch (error) {
				const modelPrefs = await getPi()
					.getModelPrefs()
					.catch(() => previous);
				set({ modelPrefs, error: error instanceof Error ? error.message : String(error) });
			}
		},

		setModelsHidden: async (provider, modelIds, hidden) => {
			const previous = get().modelPrefs;
			const base: ModelPrefs = previous ?? { hiddenModels: {}, subagentModels: {} };
			const hiddenSet = new Set(base.hiddenModels[provider] ?? []);
			for (const id of modelIds) {
				if (hidden) hiddenSet.add(id);
				else hiddenSet.delete(id);
			}
			const hiddenModels = { ...base.hiddenModels };
			if (hiddenSet.size) hiddenModels[provider] = [...hiddenSet];
			else delete hiddenModels[provider];

			set({ modelPrefs: { ...base, hiddenModels } });
			try {
				await getPi().setModelsHidden({ provider, modelIds, hidden });
				await useSessionsStore.getState().loadModels();
			} catch (error) {
				const modelPrefs = await getPi()
					.getModelPrefs()
					.catch(() => previous);
				set({ modelPrefs, error: error instanceof Error ? error.message : String(error) });
			}
		},

		setSubagentModel: async (agent, modelRef) => {
			const previous = get().modelPrefs;
			try {
				const modelPrefs = await getPi().setSubagentModel({ agent, modelRef });
				set({ modelPrefs });
			} catch (error) {
				set({ modelPrefs: previous, error: error instanceof Error ? error.message : String(error) });
			}
		},

		setSubagentThinking: async (agent, level) => {
			const previous = get().modelPrefs;
			try {
				const modelPrefs = await getPi().setSubagentThinking({ agent, level });
				set({ modelPrefs });
			} catch (error) {
				set({ modelPrefs: previous, error: error instanceof Error ? error.message : String(error) });
			}
		},

		setSubagentPreferBuiltin: async (enabled) => {
			const previous = get().modelPrefs;
			try {
				const modelPrefs = await getPi().setSubagentPreferBuiltin({ enabled });
				set({ modelPrefs });
			} catch (error) {
				set({ modelPrefs: previous, error: error instanceof Error ? error.message : String(error) });
			}
		},

		setMainAgentPrompt: async (prompt) => {
			const previous = get().modelPrefs;
			try {
				const modelPrefs = await getPi().setMainAgentPrompt({ prompt });
				set({ modelPrefs });
			} catch (error) {
				set({ modelPrefs: previous, error: error instanceof Error ? error.message : String(error) });
			}
		},

		setMainAgentName: async (name) => {
			const previous = get().modelPrefs;
			try {
				const modelPrefs = await getPi().setMainAgentName({ name });
				set({ modelPrefs });
			} catch (error) {
				set({ modelPrefs: previous, error: error instanceof Error ? error.message : String(error) });
			}
		},

		refreshSubagents: async () => {
			const [subagents, modelPrefs] = await Promise.all([getPi().listSubagents(), getPi().getModelPrefs()]);
			set({ subagents, modelPrefs });
		},

		saveSubagent: async (input) => {
			const path = await getPi().saveSubagent(input);
			await get().refreshSubagents();
			return path;
		},

		deleteSubagent: async (name) => {
			await getPi().deleteSubagent({ name });
			await get().refreshSubagents();
		},

		setSkillModelInvocationDisabled: async (name, disabled) => {
			const previousSkills = get().skills;
			const previousPrefs = get().skillPrefs;
			if (previousSkills) {
				set({
					skills: previousSkills.map((skill) =>
						skill.name === name ? { ...skill, disableModelInvocation: disabled } : skill,
					),
				});
			}
			if (previousPrefs) {
				const disabledNames = new Set(previousPrefs.modelInvocationDisabled);
				const enabledNames = new Set(previousPrefs.modelInvocationEnabled);
				if (disabled) {
					disabledNames.add(name);
					enabledNames.delete(name);
				} else {
					disabledNames.delete(name);
					enabledNames.add(name);
				}
				set({
					skillPrefs: {
						modelInvocationDisabled: [...disabledNames],
						modelInvocationEnabled: [...enabledNames],
					},
				});
			}
			try {
				const skillPrefs = await getPi().setSkillModelInvocationDisabled({ name, disabled });
				set({ skillPrefs });

				await get().refreshResources();
			} catch (error) {
				set({
					skills: previousSkills,
					skillPrefs: previousPrefs,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		},

		test: async (providerId) => {
			set((state) => ({ testResults: { ...state.testResults, [providerId]: "testing" } }));
			try {
				const result = await getPi().testProvider({ providerId });
				set((state) => ({ testResults: { ...state.testResults, [providerId]: result } }));
			} catch (error) {
				set((state) => ({
					testResults: {
						...state.testResults,
						[providerId]: { ok: false, error: error instanceof Error ? error.message : String(error) },
					},
				}));
			}
		},
	};
});

let settingsBootstrapped = false;
export function bootstrapSettings(): void {
	if (settingsBootstrapped) return;
	settingsBootstrapped = true;
	void useSettingsStore.getState().refresh();
}
