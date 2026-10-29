import { isThinkingLevel, type ModelPrefs } from "@tcode/shared";
import { JsonStore } from "../json-store";

function copyPrefs(prefs: ModelPrefs): ModelPrefs {
	const copy: ModelPrefs = {
		hiddenModels: Object.fromEntries(
			Object.entries(prefs.hiddenModels).map(([provider, ids]) => [provider, [...ids]]),
		),
		subagentModels: { ...prefs.subagentModels },
	};

	if (prefs.subagentThinking && Object.keys(prefs.subagentThinking).length > 0) {
		copy.subagentThinking = { ...prefs.subagentThinking };
	}
	if (prefs.subagentPreferBuiltin !== undefined) copy.subagentPreferBuiltin = prefs.subagentPreferBuiltin;
	if (prefs.mainAgentPrompt) copy.mainAgentPrompt = prefs.mainAgentPrompt;
	if (prefs.mainAgentName) copy.mainAgentName = prefs.mainAgentName;
	return copy;
}

function normalizeStringMap(value: unknown): Record<string, string> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value).flatMap(([key, item]) => {
			const cleanKey = key.trim();
			const cleanValue = typeof item === "string" ? item.trim() : "";
			return cleanKey && cleanValue ? [[cleanKey, cleanValue]] : [];
		}),
	);
}

function normalizeHiddenModels(value: unknown): Record<string, string[]> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value).flatMap(([provider, ids]) => {
			const cleanProvider = provider.trim();
			if (!cleanProvider || !Array.isArray(ids)) return [];
			const cleanIds = [
				...new Set(ids.filter((id): id is string => typeof id === "string").map((id) => id.trim())),
			]
				.filter(Boolean)
				.sort();
			return cleanIds.length ? [[cleanProvider, cleanIds]] : [];
		}),
	);
}

function normalizeThinkingMap(value: unknown): Record<string, string> {
	return Object.fromEntries(
		Object.entries(normalizeStringMap(value)).filter(([, level]) => isThinkingLevel(level)),
	);
}

export class ModelPrefsService {
	private cache: ModelPrefs | null = null;

	constructor(private readonly configPath: string) {}

	private store(): JsonStore<Partial<ModelPrefs>> {
		return new JsonStore<Partial<ModelPrefs>>({
			path: this.configPath,
			defaultValue: () => ({}),
		});
	}

	private async read(): Promise<ModelPrefs> {
		if (this.cache) return this.cache;

		const data = await this.store().read();
		const thinking = normalizeThinkingMap(data.subagentThinking);
		const prefs: ModelPrefs = {
			hiddenModels: normalizeHiddenModels(data.hiddenModels),
			subagentModels: normalizeStringMap(data.subagentModels),
		};
		if (Object.keys(thinking).length > 0) prefs.subagentThinking = thinking;

		if (typeof data.subagentPreferBuiltin === "boolean") {
			prefs.subagentPreferBuiltin = data.subagentPreferBuiltin;
		}
		const mainAgentPrompt = typeof data.mainAgentPrompt === "string" ? data.mainAgentPrompt.trim() : "";
		if (mainAgentPrompt) prefs.mainAgentPrompt = mainAgentPrompt;
		const mainAgentName = typeof data.mainAgentName === "string" ? data.mainAgentName.trim() : "";
		if (mainAgentName) prefs.mainAgentName = mainAgentName;
		this.cache = prefs;
		return prefs;
	}

	private async write(prefs: ModelPrefs): Promise<void> {
		this.cache = prefs;
		await this.store().write(prefs);
	}

	async getPrefs(): Promise<ModelPrefs> {
		return copyPrefs(await this.read());
	}

	async isModelHidden(provider: string, modelId: string): Promise<boolean> {
		return (await this.read()).hiddenModels[provider]?.includes(modelId) ?? false;
	}

	async setModelHidden(provider: string, modelId: string, hidden: boolean): Promise<ModelPrefs> {
		const cleanProvider = provider.trim();
		const cleanModelId = modelId.trim();
		if (!cleanProvider || !cleanModelId) throw new Error("provider and modelId are required");
		const prefs = copyPrefs(await this.read());
		const ids = new Set(prefs.hiddenModels[cleanProvider] ?? []);
		if (hidden) ids.add(cleanModelId);
		else ids.delete(cleanModelId);
		if (ids.size) prefs.hiddenModels[cleanProvider] = [...ids].sort();
		else delete prefs.hiddenModels[cleanProvider];
		await this.write(prefs);
		return copyPrefs(prefs);
	}

	async setModelsHidden(provider: string, modelIds: string[], hidden: boolean): Promise<ModelPrefs> {
		const cleanProvider = provider.trim();
		if (!cleanProvider) throw new Error("provider is required");
		const ids = [...new Set(modelIds.map((id) => id.trim()).filter(Boolean))].sort();
		if (!ids.length) return copyPrefs(await this.read());
		const prefs = copyPrefs(await this.read());
		const set = new Set(prefs.hiddenModels[cleanProvider] ?? []);
		if (hidden) {
			for (const id of ids) set.add(id);
		} else {
			for (const id of ids) set.delete(id);
		}
		if (set.size) prefs.hiddenModels[cleanProvider] = [...set].sort();
		else delete prefs.hiddenModels[cleanProvider];
		await this.write(prefs);
		return copyPrefs(prefs);
	}

	async setSubagentModel(agent: string, modelRef: string | null): Promise<ModelPrefs> {
		const cleanAgent = agent.trim();
		if (!cleanAgent) throw new Error("agent is required");
		const prefs = copyPrefs(await this.read());
		const cleanModelRef = modelRef?.trim() ?? "";
		if (cleanModelRef) prefs.subagentModels[cleanAgent] = cleanModelRef;
		else delete prefs.subagentModels[cleanAgent];
		await this.write(prefs);
		return copyPrefs(prefs);
	}

	async getSubagentModel(agent: string): Promise<string | undefined> {
		return (await this.read()).subagentModels[agent];
	}

	async getSubagentThinking(agent: string): Promise<string | undefined> {
		return (await this.read()).subagentThinking?.[agent];
	}

	async setSubagentThinking(agent: string, level: string | null): Promise<ModelPrefs> {
		const cleanAgent = agent.trim();
		if (!cleanAgent) throw new Error("agent is required");
		const cleanLevel = level?.trim() ?? "";
		if (cleanLevel && !isThinkingLevel(cleanLevel)) throw new Error(`invalid thinking level: ${cleanLevel}`);
		const prefs = copyPrefs(await this.read());
		const thinking = { ...(prefs.subagentThinking ?? {}) };
		if (cleanLevel) thinking[cleanAgent] = cleanLevel;
		else delete thinking[cleanAgent];
		if (Object.keys(thinking).length > 0) prefs.subagentThinking = thinking;
		else delete prefs.subagentThinking;
		await this.write(prefs);
		return copyPrefs(prefs);
	}

	async getSubagentPreferBuiltin(): Promise<boolean> {
		return (await this.read()).subagentPreferBuiltin !== false;
	}

	async setSubagentPreferBuiltin(enabled: boolean): Promise<ModelPrefs> {
		const prefs = copyPrefs(await this.read());
		prefs.subagentPreferBuiltin = enabled;
		await this.write(prefs);
		return copyPrefs(prefs);
	}

	async getMainAgentPrompt(): Promise<string | undefined> {
		return (await this.read()).mainAgentPrompt;
	}

	async setMainAgentPrompt(prompt: string | null): Promise<ModelPrefs> {
		const prefs = copyPrefs(await this.read());
		const cleanPrompt = prompt?.trim() ?? "";
		if (cleanPrompt) prefs.mainAgentPrompt = cleanPrompt;
		else delete prefs.mainAgentPrompt;
		await this.write(prefs);
		return copyPrefs(prefs);
	}

	async getMainAgentName(): Promise<string | undefined> {
		return (await this.read()).mainAgentName;
	}

	async setMainAgentName(name: string | null): Promise<ModelPrefs> {
		const prefs = copyPrefs(await this.read());
		const cleanName = name?.trim() ?? "";
		if (cleanName) prefs.mainAgentName = cleanName;
		else delete prefs.mainAgentName;
		await this.write(prefs);
		return copyPrefs(prefs);
	}

	async renameSubagent(from: string, to: string): Promise<ModelPrefs> {
		const cleanFrom = from.trim();
		const cleanTo = to.trim();
		if (!cleanFrom || !cleanTo || cleanFrom === cleanTo) return copyPrefs(await this.read());
		const prefs = copyPrefs(await this.read());
		let changed = false;
		const model = prefs.subagentModels[cleanFrom];
		if (model) {
			delete prefs.subagentModels[cleanFrom];
			prefs.subagentModels[cleanTo] = model;
			changed = true;
		}
		const thinking = prefs.subagentThinking?.[cleanFrom];
		if (thinking) {
			const thinkingMap = { ...prefs.subagentThinking };
			delete thinkingMap[cleanFrom];
			thinkingMap[cleanTo] = thinking;
			prefs.subagentThinking = thinkingMap;
			changed = true;
		}
		if (!changed) return copyPrefs(prefs);
		await this.write(prefs);
		return copyPrefs(prefs);
	}

	async forgetSubagent(agent: string): Promise<ModelPrefs> {
		const clean = agent.trim();
		if (!clean) return copyPrefs(await this.read());
		const prefs = copyPrefs(await this.read());
		let changed = false;
		if (prefs.subagentModels[clean]) {
			delete prefs.subagentModels[clean];
			changed = true;
		}
		if (prefs.subagentThinking?.[clean]) {
			const thinkingMap = { ...prefs.subagentThinking };
			delete thinkingMap[clean];
			if (Object.keys(thinkingMap).length > 0) prefs.subagentThinking = thinkingMap;
			else delete prefs.subagentThinking;
			changed = true;
		}
		if (!changed) return copyPrefs(prefs);
		await this.write(prefs);
		return copyPrefs(prefs);
	}
}
