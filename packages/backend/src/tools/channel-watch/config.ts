import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JsonStore } from "../../json-store";
import { createLogger } from "../../log";

const log = createLogger("channel-watch-config");

const CACHE_TTL_MS = 2000;
const cache = new Map<string, { value: boolean; expires: number }>();

const DEFAULT_ENABLED = false;

function stripJsonC(raw: string): string {
	return raw
		.replace(/^\s*\/\/.*$/gm, "")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/,\s*([}\]])/g, "$1");
}

function parseSettings(raw: string): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return null;
	} catch {
		try {
			const parsed = JSON.parse(stripJsonC(raw)) as unknown;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>;
			}
			return null;
		} catch {
			return null;
		}
	}
}

export function readChannelWatchEnabled(agentDir: string): boolean {
	const file = join(agentDir, "settings.json");
	const now = Date.now();
	const cached = cache.get(agentDir);
	if (cached && cached.expires > now) return cached.value;
	let value = DEFAULT_ENABLED;
	try {
		const raw = readFileSync(file, "utf8");
		const parsed = parseSettings(raw);

		value = typeof parsed?.channelWatchEnabled === "boolean" ? parsed.channelWatchEnabled : DEFAULT_ENABLED;
	} catch (err) {
		const code = (err as { code?: string }).code;
		if (code !== "ENOENT") {
			log.warn("channel-watch 开关读取失败，按默认开处理", {
				file,
				error: err instanceof Error ? err.message : String(err),
			});
		}
		value = DEFAULT_ENABLED;
	}
	cache.set(agentDir, { value: value, expires: now + CACHE_TTL_MS });
	return value;
}

export function clearChannelWatchEnabledCache(): void {
	cache.clear();
}

export function writeChannelWatchEnabled(agentDir: string, enabled: boolean): void {
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
		existing.channelWatchEnabled = enabled;
	});
	clearChannelWatchEnabledCache();
}
