import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ContextManagerMode } from "@tcode/shared";
import { JsonStore } from "../../json-store";
import { createLogger } from "../../log";
import { DEFAULT_EVAP_CONFIG, type EvapConfig } from "./types";

const log = createLogger("context-evaporation-config");

const CACHE_TTL_MS = 2000;

const evapCache = new Map<string, { value: unknown; expires: number }>();
const modeCache = new Map<string, { value: ContextManagerMode; expires: number }>();

function stripJsonC(raw: string): string {
	return raw
		.replace(/^\s*\/\/.*$/gm, "")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/,\s*([}\]])/g, "$1");
}

function parseSettings(raw: string): Record<string, unknown> | null {
	for (const candidate of [raw, stripJsonC(raw)]) {
		try {
			const parsed = JSON.parse(candidate) as unknown;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>;
			}
			return null;
		} catch {}
	}
	return null;
}

function readSettingsRaw(agentDir: string): Record<string, unknown> {
	try {
		return parseSettings(readFileSync(join(agentDir, "settings.json"), "utf8")) ?? {};
	} catch (err) {
		const code = (err as { code?: string }).code;
		if (code !== "ENOENT") {
			log.warn("settings.json 读取失败，按缺省处理", {
				file: join(agentDir, "settings.json"),
				error: err instanceof Error ? err.message : String(err),
			});
		}
		return {};
	}
}

function numOr(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function readEvapConfig(agentDir: string): EvapConfig {
	const now = Date.now();
	const cached = evapCache.get(agentDir);
	if (cached && cached.expires > now) return cached.value as EvapConfig;

	const raw = readSettingsRaw(agentDir);
	const src =
		raw.contextEvaporation &&
		typeof raw.contextEvaporation === "object" &&
		!Array.isArray(raw.contextEvaporation)
			? (raw.contextEvaporation as Record<string, unknown>)
			: {};
	const tiersSrc =
		src.tiers && typeof src.tiers === "object" && !Array.isArray(src.tiers)
			? (src.tiers as Record<string, unknown>)
			: {};
	const tiers = {
		snip: numOr(tiersSrc.snip, DEFAULT_EVAP_CONFIG.tiers.snip),
		prune: numOr(tiersSrc.prune, DEFAULT_EVAP_CONFIG.tiers.prune),
		summarize: numOr(tiersSrc.summarize, DEFAULT_EVAP_CONFIG.tiers.summarize),
	};
	const tier2Scope: "all" | "gt4k" =
		src.tier2Scope === "gt4k" ? "gt4k" : src.tier2Scope === "all" ? "all" : DEFAULT_EVAP_CONFIG.tier2Scope;
	const protectedTools = Array.isArray(src.protectedTools)
		? src.protectedTools.filter((t): t is string => typeof t === "string")
		: DEFAULT_EVAP_CONFIG.protectedTools;
	const value: EvapConfig = {
		tiers,
		budgetTokens: numOr(src.budgetTokens, DEFAULT_EVAP_CONFIG.budgetTokens),
		protectionTokens: numOr(src.protectionTokens, DEFAULT_EVAP_CONFIG.protectionTokens),
		keepRecentImages: numOr(src.keepRecentImages, DEFAULT_EVAP_CONFIG.keepRecentImages),
		headLines: numOr(src.headLines, DEFAULT_EVAP_CONFIG.headLines),
		tailLines: numOr(src.tailLines, DEFAULT_EVAP_CONFIG.tailLines),
		headTailThreshold: numOr(src.headTailThreshold, DEFAULT_EVAP_CONFIG.headTailThreshold),
		tier2Scope,
		trimAssistantText: src.trimAssistantText === true,
		protectedTools,
	};
	evapCache.set(agentDir, { value, expires: now + CACHE_TTL_MS });
	return value;
}

export function readContextManagerMode(agentDir: string): ContextManagerMode {
	const now = Date.now();
	const cached = modeCache.get(agentDir);
	if (cached && cached.expires > now) return cached.value;

	const raw = readSettingsRaw(agentDir);
	const evapSrc =
		raw.contextEvaporation &&
		typeof raw.contextEvaporation === "object" &&
		!Array.isArray(raw.contextEvaporation)
			? (raw.contextEvaporation as Record<string, unknown>)
			: {};
	const mode: ContextManagerMode = evapSrc.enabled === false ? "off" : "evaporation";
	modeCache.set(agentDir, { value: mode, expires: now + CACHE_TTL_MS });
	return mode;
}

export function writeContextManagerMode(agentDir: string, mode: ContextManagerMode): void {
	const store = new JsonStore<Record<string, unknown>>({
		path: join(agentDir, "settings.json"),
		defaultValue: () => ({}),
		parse: (raw) => {
			const parsed = parseSettings(raw);
			if (!parsed) throw new Error("settings.json 解析失败（非对象）");
			return parsed;
		},
	});
	store.updateSync((existing) => {
		const evap =
			existing.contextEvaporation &&
			typeof existing.contextEvaporation === "object" &&
			!Array.isArray(existing.contextEvaporation)
				? { ...(existing.contextEvaporation as Record<string, unknown>) }
				: {};
		evap.enabled = mode === "evaporation";
		existing.contextEvaporation = evap;
		delete existing.acpCompressionEnabled;
	});
	clearEvapConfigCache(agentDir);
}

export function clearEvapConfigCache(agentDir?: string): void {
	if (agentDir) {
		evapCache.delete(agentDir);
		modeCache.delete(agentDir);
	} else {
		evapCache.clear();
		modeCache.clear();
	}
}
