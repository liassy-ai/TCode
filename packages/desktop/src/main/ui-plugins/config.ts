import { join } from "node:path";
import { createLogger, JsonStore } from "@tcode/backend";
import type { UiPluginsConfig } from "@tcode/shared";
import { app } from "electron";

const log = createLogger("ui-plugins-config");

export function defaultUiPluginsConfig(): UiPluginsConfig {
	return { enabled: false, plugins: {}, assignments: {} };
}

function uiPluginsConfigPath(): string {
	return join(app.getPath("userData"), "ui-plugins.json");
}

function configStore(): JsonStore<Partial<UiPluginsConfig> | null> {
	return new JsonStore<Partial<UiPluginsConfig> | null>({
		path: uiPluginsConfigPath(),
		defaultValue: () => null,
	});
}

function normalize(parsed: Partial<UiPluginsConfig>): UiPluginsConfig {
	const plugins: UiPluginsConfig["plugins"] = {};
	if (parsed.plugins && typeof parsed.plugins === "object") {
		for (const [name, p] of Object.entries(parsed.plugins)) {
			if (!p || typeof p !== "object") continue;
			plugins[name] = {
				enabled: typeof p.enabled === "boolean" ? p.enabled : false,
				trusted: typeof p.trusted === "boolean" ? p.trusted : false,
			};
		}
	}

	const assignments: UiPluginsConfig["assignments"] = {};
	if (parsed.assignments && typeof parsed.assignments === "object") {
		for (const [slot, name] of Object.entries(parsed.assignments)) {
			if (typeof name === "string") assignments[slot] = name;
		}
	}
	return {
		enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : false,
		plugins,
		assignments,
	};
}

export async function loadUiPluginsConfig(): Promise<UiPluginsConfig> {
	const parsed = await configStore().read();
	return normalize(parsed ?? {});
}

export async function saveUiPluginsConfig(patch: Partial<UiPluginsConfig>): Promise<void> {
	try {
		await configStore().update((draft) => normalize({ ...(draft ?? {}), ...patch }));
	} catch (err) {
		log.error("ui-plugins config save failed", err);
		throw err;
	}
}
