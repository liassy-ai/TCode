import { join } from "node:path";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { getAgentDir, type ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
	CUSTOM_THINKING_LEVELS,
	type CustomProviderInput,
	type CustomProviderUpdateInput,
	type ListProvidersOptions,
	OFF_THINKING_LEVEL_KEY,
	OFF_THINKING_LEVEL_VALUE,
	type ProviderInfo,
	type ProviderTestResult,
	type ThinkingLevelMapInput,
} from "@tcode/shared";
import { JsonStore } from "../json-store";

const BUILTIN_PROVIDER_IDS = new Set(builtinProviders().map((p) => p.id));

const MANAGED_PROVIDER_FIELDS = ["name", "baseUrl", "api", "models"] as const;

function thinkingLevelMapField(map: ThinkingLevelMapInput | undefined, reasoning: boolean): JsonObject {
	const entries: Array<[string, string | null]> = [];
	if (reasoning) entries.push([OFF_THINKING_LEVEL_KEY, OFF_THINKING_LEVEL_VALUE]);
	for (const level of CUSTOM_THINKING_LEVELS) {
		const value = map?.[level];
		if (value === null) entries.push([level, null]);
		else if (typeof value === "string" && value.trim()) entries.push([level, value.trim()]);
	}
	if (entries.length === 0) return {};
	return { thinkingLevelMap: Object.fromEntries(entries) };
}

function readThinkingLevelMap(raw: JsonObject): ThinkingLevelMapInput | undefined {
	const map = raw.thinkingLevelMap;
	if (!map || typeof map !== "object") return undefined;
	const m = map as JsonObject;
	const out: ThinkingLevelMapInput = {};
	for (const level of CUSTOM_THINKING_LEVELS) {
		const value = m[level];
		if (typeof value === "string" || value === null) out[level] = value;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

type JsonObject = Record<string, unknown>;

const NETWORK_REFRESH_TIMEOUT_MS = 15_000;

function stripJsonComments(raw: string): string {
	return raw.replace(/\/\/[^\n"]*(?=\n)/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function jsonStoreFor(path: string, mode?: number): JsonStore<JsonObject> {
	return new JsonStore<JsonObject>({
		path,
		defaultValue: () => ({}),
		mode,
		parse: (raw) => JSON.parse(stripJsonComments(raw)) as JsonObject,
	});
}

async function readJsonFile(path: string): Promise<JsonObject> {
	return jsonStoreFor(path).read();
}

export class SettingsService {
	constructor(private readonly getRuntime: () => Promise<ModelRuntime>) {}

	private get authPath(): string {
		return join(getAgentDir(), "auth.json");
	}

	private get modelsJsonPath(): string {
		return join(getAgentDir(), "models.json");
	}

	private async readCustomProviders(): Promise<JsonObject> {
		const data = await readJsonFile(this.modelsJsonPath);
		return (data.providers as JsonObject | undefined) ?? {};
	}

	private async refreshLocalModels(): Promise<void> {
		const runtime = await this.getRuntime();

		await runtime.refresh({ allowNetwork: false });
	}

	private customModelMeta(customEntry: JsonObject | undefined): Map<string, JsonObject> {
		const map = new Map<string, JsonObject>();
		const rawModels = customEntry?.models;
		if (!Array.isArray(rawModels)) return map;
		for (const raw of rawModels) {
			if (raw && typeof raw === "object" && typeof (raw as JsonObject).id === "string") {
				map.set((raw as JsonObject).id as string, raw as JsonObject);
			}
		}
		return map;
	}

	async listProviders(options?: ListProvidersOptions): Promise<ProviderInfo[]> {
		const runtime = await this.getRuntime();
		if (options?.forceNetwork) {
			const result = await runtime.refresh({
				allowNetwork: true,
				force: true,
				signal: AbortSignal.timeout(NETWORK_REFRESH_TIMEOUT_MS),
			});
			if (result.aborted) throw new Error("刷新模型目录超时，请检查网络后重试");
		} else {
			await runtime.refresh({ allowNetwork: false });
		}
		const customs = await this.readCustomProviders();
		const customIds = new Set(Object.keys(customs));
		return runtime
			.getProviders()
			.map((provider) => {
				const status = runtime.getProviderAuthStatus(provider.id);
				const customEntry = customs[provider.id] as JsonObject | undefined;
				const modelMeta = this.customModelMeta(customEntry);
				const managed = runtime.getRegisteredNativeProvider(provider.id) !== undefined;

				const hideAuthLabel = managed;
				return {
					id: provider.id,
					name: provider.name || provider.id,
					custom: customIds.has(provider.id),
					...(managed ? { managed: true } : {}),

					overridesBuiltin:
						(customIds.has(provider.id) &&
							typeof customEntry?.baseUrl === "string" &&
							BUILTIN_PROVIDER_IDS.has(provider.id)) ||
						undefined,
					configured: status.configured,
					authSource: status.source,
					authLabel: hideAuthLabel ? undefined : status.label,

					oauth: provider.auth.oauth
						? {
								loginLabel: provider.auth.oauth.loginLabel,
								isSubscription: provider.auth.oauth.isSubscription,
							}
						: undefined,

					...(provider.auth.apiKey?.login ? { apiKeyLogin: true } : {}),

					...(customEntry
						? {
								baseUrl: typeof customEntry.baseUrl === "string" ? customEntry.baseUrl : undefined,
								api: typeof customEntry.api === "string" ? customEntry.api : undefined,

								customModels: [...modelMeta.values()].map((raw) => {
									const thinkingLevelMap = readThinkingLevelMap(raw);
									return {
										id: String(raw.id),
										...(typeof raw.name === "string" ? { name: raw.name } : {}),
										...(raw.reasoning === true ? { reasoning: true } : {}),
										...(typeof raw.contextWindow === "number" ? { contextWindow: raw.contextWindow } : {}),
										...(typeof raw.maxTokens === "number" ? { maxTokens: raw.maxTokens } : {}),
										...(Array.isArray(raw.input) && raw.input.includes("image") ? { imageInput: true } : {}),
										...(thinkingLevelMap ? { thinkingLevelMap } : {}),
									};
								}),
							}
						: {}),
					models: runtime.getModels(provider.id).map((model) => {
						const raw = modelMeta.get(model.id);
						const fallback = managed
							? {
									reasoning: model.reasoning || undefined,
									contextWindow: model.contextWindow,
									maxTokens: model.maxTokens,
									imageInput: model.input.includes("image") || undefined,
								}
							: {};
						return {
							id: model.id,
							name: model.name,
							...(raw
								? {
										reasoning: raw.reasoning === true || undefined,
										contextWindow: typeof raw.contextWindow === "number" ? raw.contextWindow : undefined,
										maxTokens: typeof raw.maxTokens === "number" ? raw.maxTokens : undefined,
										imageInput: (Array.isArray(raw.input) && raw.input.includes("image")) || undefined,
									}
								: fallback),
						};
					}),
				};
			})
			.sort(
				(a, b) =>
					(b.managed ? 1 : 0) - (a.managed ? 1 : 0) ||
					(b.configured ? 1 : 0) - (a.configured ? 1 : 0) ||
					a.id.localeCompare(b.id),
			);
	}

	async saveApiKey(providerId: string, key: string): Promise<void> {
		const trimmed = key.trim();
		if (!trimmed) throw new Error("API key 不能为空");
		await jsonStoreFor(this.authPath, 0o600).update((auth) => {
			auth[providerId] = { type: "api_key", key: trimmed };
		});
		await this.refreshLocalModels();
	}

	async removeCredential(providerId: string): Promise<void> {
		const runtime = await this.getRuntime();
		await runtime.logout(providerId);
		await this.refreshLocalModels();
	}

	private assertModelsMeaningful(id: string, models: readonly { id: string }[]): void {
		if (models.length > 0) return;
		if (!BUILTIN_PROVIDER_IDS.has(id)) {
			throw new Error(
				`${id} 不是内置 provider，留空模型列表无法使用；覆写内置 provider（如 openai）请用其 ID 并留空模型，即沿用官方模型列表`,
			);
		}
	}

	private buildCustomEntry(input: CustomProviderInput): JsonObject {
		if (!input.baseUrl.trim()) throw new Error("baseUrl 不能为空");
		if (!/^https?:\/\//i.test(input.baseUrl.trim())) {
			throw new Error("baseUrl 必须以 http(s):// 开头");
		}
		if (!input.api.trim()) throw new Error("api 协议不能为空");
		const models = input.models.filter((m) => m.id.trim());
		return {
			...(input.name?.trim() ? { name: input.name.trim() } : {}),
			baseUrl: input.baseUrl.trim(),
			api: input.api.trim(),

			...(models.length > 0
				? {
						models: models.map((m) => {
							for (const [field, value] of [
								["contextWindow", m.contextWindow],
								["maxTokens", m.maxTokens],
							] as const) {
								if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
									throw new Error(`模型 ${m.id.trim()} 的 ${field} 必须是正数`);
								}
							}

							return {
								id: m.id.trim(),
								...(m.name?.trim() ? { name: m.name.trim() } : {}),
								...(m.reasoning ? { reasoning: true } : {}),
								...(m.contextWindow ? { contextWindow: Math.round(m.contextWindow) } : {}),
								...(m.maxTokens ? { maxTokens: Math.round(m.maxTokens) } : {}),
								...(m.imageInput ? { input: ["text", "image"] } : {}),
								...thinkingLevelMapField(m.thinkingLevelMap, m.reasoning === true),
							};
						}),
					}
				: {}),
		};
	}

	async addCustomProvider(input: CustomProviderInput): Promise<void> {
		const id = input.id.trim();
		if (!id) throw new Error("Provider ID 不能为空");
		if (!/^[a-z0-9][a-z0-9-_]*$/i.test(id)) throw new Error("Provider ID 只能包含字母、数字、-、_");

		this.assertModelsMeaningful(
			id,
			input.models.filter((m) => m.id.trim()),
		);

		await jsonStoreFor(this.modelsJsonPath).update((draft) => {
			const providers = (draft.providers as JsonObject | undefined) ?? {};
			providers[id] = this.buildCustomEntry(input);
			draft.providers = providers;
		});

		const apiKey = input.apiKey?.trim();
		if (apiKey) {
			await jsonStoreFor(this.authPath, 0o600).update((auth) => {
				auth[id] = { type: "api_key", key: apiKey };
			});
		}

		await this.refreshLocalModels();
	}

	async updateCustomProvider(input: CustomProviderUpdateInput): Promise<void> {
		const id = input.id.trim();
		if (!id) throw new Error("Provider ID 不能为空");

		this.assertModelsMeaningful(
			id,
			input.models.filter((m) => m.id.trim()),
		);
		await jsonStoreFor(this.modelsJsonPath).update((draft) => {
			const providers = (draft.providers as JsonObject | undefined) ?? {};
			if (!(id in providers)) throw new Error(`自定义 provider 不存在：${id}`);

			const preserved = { ...(providers[id] as JsonObject) };
			for (const field of MANAGED_PROVIDER_FIELDS) delete preserved[field];
			providers[id] = { ...preserved, ...this.buildCustomEntry(input) };
			draft.providers = providers;
		});

		const apiKey = input.apiKey?.trim();
		if (apiKey) {
			await jsonStoreFor(this.authPath, 0o600).update((auth) => {
				auth[id] = { type: "api_key", key: apiKey };
			});
		}

		await this.refreshLocalModels();
	}

	async setProviderBaseUrl(providerId: string, baseUrl: string, apiKey?: string): Promise<void> {
		const id = providerId.trim();
		if (!id) throw new Error("Provider ID 不能为空");
		if (!BUILTIN_PROVIDER_IDS.has(id)) {
			throw new Error(`${id} 不是内置 provider，请改用「自定义 Provider」配置`);
		}
		const trimmedBase = baseUrl.trim();
		if (trimmedBase && !/^https?:\/\//i.test(trimmedBase)) {
			throw new Error("baseUrl 必须以 http(s):// 开头");
		}
		await jsonStoreFor(this.modelsJsonPath).update((draft) => {
			const providers = (draft.providers as JsonObject | undefined) ?? {};
			const entry = providers[id] as JsonObject | undefined;
			if (trimmedBase) {
				providers[id] = { ...entry, baseUrl: trimmedBase };
			} else if (entry) {
				delete providers[id];
			}
			draft.providers = providers;
		});

		const trimmedKey = apiKey?.trim();
		if (trimmedKey) {
			await jsonStoreFor(this.authPath, 0o600).update((auth) => {
				auth[id] = { type: "api_key", key: trimmedKey };
			});
		}

		await this.refreshLocalModels();
	}

	async removeCustomProvider(providerId: string): Promise<void> {
		const data = await readJsonFile(this.modelsJsonPath);
		const providers = (data.providers as JsonObject | undefined) ?? {};
		if (providerId in providers) {
			await jsonStoreFor(this.modelsJsonPath).update((draft) => {
				const p = (draft.providers as JsonObject | undefined) ?? {};
				delete p[providerId];
				draft.providers = p;
			});
		}
		const auth = await readJsonFile(this.authPath);
		if (providerId in auth) {
			await jsonStoreFor(this.authPath, 0o600).update((draft) => {
				delete draft[providerId];
			});
		}
		await this.refreshLocalModels();
	}

	async testProvider(providerId: string, modelId?: string): Promise<ProviderTestResult> {
		const runtime = await this.getRuntime();
		const status = runtime.getProviderAuthStatus(providerId);
		if (!status.configured) {
			return { ok: false, error: "未配置凭证" };
		}
		const model = modelId
			? runtime.getModel(providerId, modelId)
			: (runtime.getModels(providerId)[0] ?? undefined);
		if (!model) {
			return { ok: false, error: "该 provider 下没有可用模型" };
		}
		try {
			await runtime.completeSimple(model, {
				messages: [{ role: "user", content: "ping", timestamp: Date.now() }],
			});
			return { ok: true, modelId: model.id };
		} catch (error) {
			return { ok: false, modelId: model.id, error: error instanceof Error ? error.message : String(error) };
		}
	}
}
