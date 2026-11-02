import type { SkillPrefs, SkillSpace } from "@tcode/shared";
import { skillDefaultsOffIn, skillTierOf } from "@tcode/shared";
import { JsonStore } from "../json-store";
import { readChannelWatchEnabled } from "../tools/channel-watch/config";

function copyPrefs(prefs: SkillPrefs): SkillPrefs {
	return {
		modelInvocationDisabled: [...prefs.modelInvocationDisabled],
		modelInvocationEnabled: [...prefs.modelInvocationEnabled],
	};
}

function normalizeNames(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [
		...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim())),
	]
		.filter(Boolean)
		.sort();
}

export class SkillPrefsService {
	private cache: SkillPrefs | null = null;

	constructor(
		private readonly configPath: string,
		private readonly agentDir: string,
	) {}

	private store(): JsonStore<Partial<SkillPrefs>> {
		return new JsonStore<Partial<SkillPrefs>>({
			path: this.configPath,
			defaultValue: () => ({}),
		});
	}

	private async read(): Promise<SkillPrefs> {
		if (this.cache) return this.cache;

		const data = await this.store().read();
		const prefs: SkillPrefs = {
			modelInvocationDisabled: normalizeNames(data.modelInvocationDisabled),
			modelInvocationEnabled: normalizeNames(data.modelInvocationEnabled),
		};
		this.cache = prefs;
		return prefs;
	}

	private async write(prefs: SkillPrefs): Promise<void> {
		this.cache = prefs;
		await this.store().write(prefs);
	}

	async getPrefs(): Promise<SkillPrefs> {
		return copyPrefs(await this.read());
	}

	private effectiveDisabled(prefs: SkillPrefs, space: SkillSpace = "daily"): Set<string> {
		const enabled = new Set(prefs.modelInvocationEnabled);
		const result = new Set<string>();

		const channelWatch = readChannelWatchEnabled(this.agentDir);
		for (const name of skillDefaultsOffIn(space, channelWatch)) if (!enabled.has(name)) result.add(name);
		for (const name of prefs.modelInvocationDisabled) if (!enabled.has(name)) result.add(name);
		return result;
	}

	async getDisabledNames(space: SkillSpace = "daily"): Promise<Set<string>> {
		return this.effectiveDisabled(await this.read(), space);
	}

	getDisabledNamesSync(space: SkillSpace = "daily"): ReadonlySet<string> {
		return this.effectiveDisabled(
			this.cache ?? { modelInvocationDisabled: [], modelInvocationEnabled: [] },
			space,
		);
	}

	async setModelInvocationDisabled(name: string, disabled: boolean): Promise<SkillPrefs> {
		const cleanName = name.trim();
		if (!cleanName) throw new Error("skill name is required");

		if (disabled && skillTierOf(cleanName) === "core") {
			throw new Error(`"${cleanName}" is a core skill and cannot be disabled`);
		}
		const prefs = copyPrefs(await this.read());
		const disabledNames = new Set(prefs.modelInvocationDisabled);
		const enabledNames = new Set(prefs.modelInvocationEnabled);
		if (disabled) {
			disabledNames.add(cleanName);
			enabledNames.delete(cleanName);
		} else {
			disabledNames.delete(cleanName);
			enabledNames.add(cleanName);
		}
		prefs.modelInvocationDisabled = [...disabledNames].sort();
		prefs.modelInvocationEnabled = [...enabledNames].sort();
		await this.write(prefs);
		return copyPrefs(prefs);
	}
}
