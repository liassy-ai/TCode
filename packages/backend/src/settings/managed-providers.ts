import type { Api, Context, Model, Provider, ProviderStreams, ThinkingLevelMap } from "@earendil-works/pi-ai";
import { createProvider } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

export interface ManagedRoute {
	thinking?: string;
	model?: string;
	thinkingActual?: string;
	baseUrl?: string;
	protocol?: string;
	apiKey?: string;
	systemPrompt?: string;
	contextWindow?: number;
	maxTokens?: number;
}

export interface ManagedModel {
	alias: string;
	name?: string;
	systemPrompt?: string;
	allowed?: boolean;
	note?: string;
	routes?: ManagedRoute[];
	reasoning?: boolean;
	contextWindow?: number;
	maxTokens?: number;
	imageInput?: boolean;
}

export interface ManagedProviderSpec {
	id: string;
	name: string;
	protocol?: string;
	baseUrl: string;
	apiKey?: string;

	models: ManagedModel[];
}

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

const managedRoutesByProvider = new Map<string, Map<string, ManagedRoute[]>>();

export function managedContextWindow(
	providerId: string,
	modelId: string,
	thinking: string | undefined,
): number | undefined {
	const routes = managedRoutesByProvider.get(providerId)?.get(modelId);
	if (!routes?.length) return undefined;
	const route = pickRoute(routes, (thinking ?? "").toLowerCase());
	return route?.contextWindow && route.contextWindow > 0 ? route.contextWindow : undefined;
}

const NO_KEY = "plugin-no-key";

function stripAuthFetch(inner: typeof fetch | undefined): typeof fetch {
	const base = inner ?? globalThis.fetch;
	return (input, init) => {
		const headers = new Headers(init?.headers ?? undefined);
		if (input instanceof Request) {
			for (const [key, value] of input.headers) {
				if (!headers.has(key)) headers.set(key, value);
			}
		}
		headers.delete("authorization");
		headers.delete("x-api-key");
		const nextInit: RequestInit = { ...(init ?? {}), headers };
		return input instanceof Request ? base(new Request(input, nextInit)) : base(input, nextInit);
	};
}

function withoutAuthOptions(options: unknown): unknown {
	const next = { ...(options as Record<string, unknown> | undefined) };
	next.fetch = stripAuthFetch(next.fetch as typeof fetch | undefined);
	return next;
}

function normalizeProtocol(raw: string | undefined): { api: Api; streams: () => ProviderStreams } {
	switch ((raw ?? "").trim().toLowerCase()) {
		case "anthropic":
			return { api: "anthropic-messages", streams: () => anthropicMessagesApi() };
		case "gemini":
		case "google":
			return { api: "google-generative-ai", streams: () => googleGenerativeAIApi() };
		default:
			return { api: "openai-completions", streams: () => openAICompletionsApi() };
	}
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function asString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function normalizeThinkingName(value: unknown): string {
	const raw = asString(value).toLowerCase();
	return raw === "xh" ? "xhigh" : raw;
}

function positive(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function parseRoutes(raw: unknown): ManagedRoute[] {
	if (!Array.isArray(raw)) return [];
	const routes: ManagedRoute[] = [];
	for (const item of raw) {
		const route = asRecord(item);
		if (!route) continue;
		const thinking = normalizeThinkingName(route.thinking);
		const model = asString(route.model);
		if (!model) continue;
		const thinkingActual = normalizeThinkingName(route.thinkingActual);
		routes.push({
			...(thinking ? { thinking } : {}),
			model,
			...(thinkingActual ? { thinkingActual } : {}),
			...(asString(route.baseUrl) ? { baseUrl: asString(route.baseUrl) } : {}),
			...(asString(route.protocol) ? { protocol: asString(route.protocol) } : {}),
			...(asString(route.apiKey) ? { apiKey: asString(route.apiKey) } : {}),
			...(asString(route.systemPrompt) ? { systemPrompt: asString(route.systemPrompt) } : {}),
			...(positive(route.contextWindow, 0) > 0 ? { contextWindow: positive(route.contextWindow, 0) } : {}),
			...(positive(route.maxTokens, 0) > 0 ? { maxTokens: positive(route.maxTokens, 0) } : {}),
		});
	}
	return routes;
}

export function parseManagedProviders(raw: unknown): ManagedProviderSpec[] {
	const root = asRecord(raw);
	if (!root || !Array.isArray(root.providers)) return [];
	const out: ManagedProviderSpec[] = [];
	for (const item of root.providers) {
		const p = asRecord(item);
		if (!p) continue;
		const baseUrl = asString(p.baseUrl);
		const idRaw = asString(p.id);
		if (!baseUrl || !/^https?:\/\//i.test(baseUrl) || !idRaw) continue;
		const id = idRaw;
		if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(id)) continue;
		const name = asString(p.name) || id;
		const modelsRaw = Array.isArray(p.models) ? p.models : [];
		const models: ManagedModel[] = [];
		for (const rawModel of modelsRaw) {
			const m = asRecord(rawModel);
			if (!m) continue;
			const alias = asString(m.alias);
			if (!alias || m.allowed === false) continue;
			const routes = parseRoutes(m.routes);
			models.push({
				alias,
				...(asString(m.note) ? { note: asString(m.note) } : {}),
				...(asString(m.name) ? { name: asString(m.name) } : {}),
				...(asString(m.systemPrompt) ? { systemPrompt: asString(m.systemPrompt) } : {}),
				...(routes.length ? { routes } : {}),
				...(m.reasoning === true || routes.length > 0 ? { reasoning: true } : {}),
				contextWindow: positive(m.contextWindow, 128000),
				maxTokens: positive(m.maxTokens, 16384),
				...(m.imageInput === true || m.multimodal === true ? { imageInput: true } : {}),
			});
		}
		out.push({
			id,
			name,
			protocol: asString(p.protocol),
			baseUrl,
			...(asString(p.apiKey) ? { apiKey: asString(p.apiKey) } : {}),
			models,
		});
	}
	return out;
}

function pickRoute(routes: ManagedRoute[], level: string): ManagedRoute | undefined {
	return (
		routes.find((route) => route.thinking === level) ?? routes.find((route) => !route.thinking) ?? routes[0]
	);
}

function buildThinkingMap(routes: ManagedRoute[]): ThinkingLevelMap | undefined {
	const map: ThinkingLevelMap = { minimal: null, low: null, medium: null, high: null };
	let count = 0;
	for (const route of routes) {
		if (!route.thinking || !THINKING_LEVELS.has(route.thinking)) continue;
		map[route.thinking as keyof ThinkingLevelMap] = route.thinkingActual ?? route.thinking;
		count++;
	}
	return count > 0 ? map : undefined;
}

export function buildManagedProvider(spec: ManagedProviderSpec): Provider {
	const protocol = normalizeProtocol(spec.protocol);
	const routeMap = new Map(spec.models.map((model) => [model.alias, model.routes ?? []]));
	managedRoutesByProvider.set(spec.id, routeMap);
	const systemMap = new Map(
		spec.models
			.filter((model) => model.systemPrompt)
			.map((model) => [model.alias, model.systemPrompt as string]),
	);

	const models: Model<Api>[] = spec.models.map((model) => ({
		id: model.alias,
		name: model.name ?? model.alias,
		api: protocol.api,
		provider: spec.id,
		baseUrl: spec.baseUrl,
		reasoning: model.reasoning === true,
		thinkingLevelMap: buildThinkingMap(model.routes ?? []),
		input: model.imageInput ? ["text", "image"] : ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: model.contextWindow ?? 128000,
		maxTokens: model.maxTokens ?? 16384,
	}));

	const streamCache = new Map<string, ProviderStreams>();
	const streamsFor = (protocolName: string | undefined): ProviderStreams => {
		const normalized = normalizeProtocol(protocolName);
		let streams = streamCache.get(normalized.api);
		if (!streams) {
			streams = normalized.streams();
			streamCache.set(normalized.api, streams);
		}
		return streams;
	};

	const remap = (
		model: Model<Api>,
		options: unknown,
	): { model: Model<Api>; options: unknown; prompt?: string; base: ProviderStreams } => {
		const routes = routeMap.get(model.id) ?? [];
		const requested = asString((options as Record<string, unknown> | undefined)?.reasoning).toLowerCase();
		const route = pickRoute(routes, requested);
		const nextModel = {
			...model,
			...(route?.model ? { id: route.model } : {}),
			...(route?.baseUrl ? { baseUrl: route.baseUrl } : {}),
			...(route?.protocol ? { api: normalizeProtocol(route.protocol).api } : {}),
		} as Model<Api>;
		let nextOptions = options;
		if (route?.thinkingActual) {
			nextOptions = { ...(options as Record<string, unknown> | undefined), reasoning: route.thinkingActual };
		}
		if (route?.apiKey) {
			nextOptions = { ...(nextOptions as Record<string, unknown> | undefined), apiKey: route.apiKey };
		}
		const hasAuthKey = Boolean(route?.apiKey || spec.apiKey);
		return {
			model: nextModel,
			options: hasAuthKey ? nextOptions : withoutAuthOptions(nextOptions),
			prompt: route?.systemPrompt ?? systemMap.get(model.id),
			base: streamsFor(route?.protocol ?? spec.protocol),
		};
	};

	const withPrompt = (context: Context, prompt: string | undefined): Context => {
		if (!prompt) return context;
		return {
			...context,
			systemPrompt: context.systemPrompt ? `${context.systemPrompt}\n\n${prompt}` : prompt,
		};
	};

	const streams: ProviderStreams = {
		stream(model, context, options) {
			const mapped = remap(model, options);
			return mapped.base.stream(mapped.model, withPrompt(context, mapped.prompt), mapped.options as never);
		},
		streamSimple(model, context, options) {
			const mapped = remap(model, options);
			return mapped.base.streamSimple(
				mapped.model,
				withPrompt(context, mapped.prompt),
				mapped.options as never,
			);
		},
	};

	const apiKey = spec.apiKey?.trim() ?? "";
	return createProvider({
		id: spec.id,
		name: spec.name,
		baseUrl: spec.baseUrl,
		auth: {
			apiKey: {
				name: `${spec.name} API key`,
				resolve: async () => ({
					auth: { apiKey: apiKey || NO_KEY },
					source: apiKey ? "plugin" : "plugin (no key)",
				}),
			},
		},
		models,
		api: streams,
	});
}
