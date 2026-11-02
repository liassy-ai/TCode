import { existsSync, type FSWatcher, watch } from "node:fs";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "@tcode/backend";
import type { UiPluginInfo, UiPluginManifest, UiPluginsConfig } from "@tcode/shared";
import { app } from "electron";
import { buildPlugin } from "./build";
import { defaultUiPluginsConfig, loadUiPluginsConfig, saveUiPluginsConfig } from "./config";

const log = createLogger("ui-plugins");

import { newestMtime } from "./fs-tree";
import { filterContributions, NAME_RE, readManifest, validateManifest } from "./manifest";
import { builtinPluginsDir, pluginsDir, seedBuiltinPlugins, seedDocs } from "./seeder";

export { filterContributions } from "./manifest";
export { uiPluginsResourcesDir } from "./seeder";

export class UiPluginManager {
	private infos = new Map<string, UiPluginInfo>();

	private dirNames = new Map<string, string>();

	private builtinNames = new Set<string>();

	private config: UiPluginsConfig = defaultUiPluginsConfig();

	private watchers: FSWatcher[] = [];

	private rebuildTimers = new Map<string, NodeJS.Timeout>();

	async init(): Promise<void> {
		await mkdir(pluginsDir(), { recursive: true });

		await rm(join(app.getPath("userData"), "ui-plugins-builtin"), { recursive: true, force: true }).catch(
			() => {},
		);
		await seedDocs();
		await seedBuiltinPlugins();
		await this.scanAll();
	}

	private async scanOne(name: string, srcDir: string): Promise<UiPluginInfo> {
		const manifest = await readManifest(srcDir);
		const invalidReason = validateManifest(name, manifest ?? {});
		const prev = this.infos.get(name);
		return {
			name,
			displayName: typeof manifest?.displayName === "string" ? manifest.displayName : undefined,
			description: typeof manifest?.description === "string" ? manifest.description : undefined,
			version: typeof manifest?.version === "string" ? manifest.version : undefined,
			tcodeUi: manifest?.tcodeUi,
			slots: manifest?.slots ?? {},
			contributions: filterContributions(manifest?.contributions),
			headless: manifest?.headless === true ? true : undefined,
			enabled: this.config.plugins[name]?.enabled ?? false,
			trusted: this.config.plugins[name]?.trusted ?? false,
			invalidReason: invalidReason ?? undefined,
			buildError: prev?.buildError,
			built: existsSync(join(srcDir, "dist/index.js")),
			builtin: this.builtinNames.has(name) || undefined,
		};
	}

	async scanAll(): Promise<UiPluginInfo[]> {
		this.config = await loadUiPluginsConfig();

		const builtinEntries = await readdir(builtinPluginsDir(), { withFileTypes: true }).catch(() => []);
		this.builtinNames = new Set(
			builtinEntries.filter((e) => e.isDirectory() && NAME_RE.test(e.name)).map((e) => e.name),
		);
		const dir = pluginsDir();
		const out: UiPluginInfo[] = [];
		const seen = new Set<string>();
		const entries = await readdir(dir, { withFileTypes: true }).catch((err) => {
			log.error("scanAll readdir failed", err);
			return [];
		});
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const name = entry.name;
			if (!NAME_RE.test(name)) continue;
			try {
				seen.add(name);
				this.dirNames.set(name, join(dir, name));
				const info = await this.scanOne(name, join(dir, name));
				this.infos.set(name, info);
				out.push(info);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				log.error("scanOne failed", name, err);
				const info: UiPluginInfo = {
					name,
					slots: {},
					contributions: [],
					enabled: false,
					trusted: false,
					built: false,
					invalidReason: `扫描异常: ${msg}`,
				};
				this.infos.set(name, info);
				out.push(info);
			}
		}

		for (const stale of [...this.infos.keys()]) {
			if (!seen.has(stale)) this.infos.delete(stale);
		}
		for (const stale of [...this.dirNames.keys()]) {
			if (!seen.has(stale)) this.dirNames.delete(stale);
		}
		return out;
	}

	list(): UiPluginInfo[] {
		return Array.from(this.infos.values());
	}

	info(name: string): UiPluginInfo | null {
		return this.infos.get(name) ?? null;
	}

	async ensureBuilt(name: string, force = false): Promise<boolean> {
		const info = this.infos.get(name);
		if (!info || info.invalidReason) return false;
		const pluginDir = this.dirNames.get(name);
		const manifest = await readManifest(pluginDir ?? "");
		if (!pluginDir || !manifest || typeof manifest.main !== "string") return false;
		const dist = join(pluginDir, "dist/index.js");
		try {
			let needsBuild = force || !existsSync(dist);
			if (!needsBuild) {
				const srcMtime = await newestMtime(pluginDir);
				const distStat = await stat(dist).catch(() => null);
				needsBuild = srcMtime === null || !distStat || srcMtime > distStat.mtimeMs;
			}
			if (needsBuild) {
				const res = await buildPlugin(pluginDir, manifest.main);
				if (res.ok) {
					this.infos.set(name, { ...info, buildError: undefined, built: true });
				} else {
					this.infos.set(name, { ...info, buildError: res.error, built: existsSync(dist) });
				}
				return res.ok;
			}
			return true;
		} catch (err) {
			log.error("ensureBuilt failed", name, err);
			return false;
		}
	}

	async readCode(name: string): Promise<{ manifest: UiPluginManifest; code: string } | { error: string }> {
		const info = this.infos.get(name);
		if (!info || info.invalidReason) return { error: `未知插件 ${name}` };
		const pluginDir = this.dirNames.get(name);
		if (!pluginDir) return { error: `未知插件 ${name}` };
		const ok = await this.ensureBuilt(name);
		if (!ok) {
			if (!existsSync(join(pluginDir, "dist/index.js"))) {
				return { error: this.infos.get(name)?.buildError ?? `构建失败：${name}` };
			}
		}
		try {
			const [manifest, code] = await Promise.all([
				readManifest(pluginDir),
				readFile(join(pluginDir, "dist/index.js"), "utf-8"),
			]);
			if (!manifest || validateManifest(name, manifest)) return { error: "manifest 校验失败" };

			const cleanManifest: UiPluginManifest = {
				...(manifest as UiPluginManifest),
				contributions: filterContributions(manifest.contributions),
			};
			return { manifest: cleanManifest, code };
		} catch (err) {
			log.error("readCode failed", name, err);
			return { error: String(err) };
		}
	}

	pluginDirOf(name: string): string | null {
		return this.dirNames.get(name) ?? null;
	}

	rootDir(): string {
		return pluginsDir();
	}

	startWatcher(onChange: (name: string) => void): void {
		if (this.watchers.length > 0) return;
		try {
			this.watchers.push(
				watch(pluginsDir(), { recursive: true }, (_event, filename) => {
					if (typeof filename !== "string") return;
					const rel = filename.split(/[\\/]/);
					const name = rel[0];
					if (!name || !NAME_RE.test(name)) return;
					const rest = rel.slice(1);
					if (rest.length === 0 || rest[0] === "dist") return;
					this.scheduleRebuild(name, onChange);
				}),
			);
		} catch (err) {
			log.error("fs.watch failed（热重载不可用，手动重建不受影响）", err);
		}
	}

	private scheduleRebuild(name: string, onChange: (name: string) => void): void {
		clearTimeout(this.rebuildTimers.get(name));
		this.rebuildTimers.set(
			name,
			setTimeout(() => {
				this.rebuildTimers.delete(name);
				void (async () => {
					await this.scanAll();
					if (!this.infos.has(name)) return;
					await this.ensureBuilt(name);
					onChange(name);
				})();
			}, 300),
		);
	}

	disposeWatcher(): void {
		for (const timer of this.rebuildTimers.values()) clearTimeout(timer);
		this.rebuildTimers.clear();
		for (const w of this.watchers) w.close();
		this.watchers = [];
	}

	async updateConfig(patch: Partial<UiPluginsConfig>): Promise<void> {
		await saveUiPluginsConfig(patch);
		await this.scanAll();
	}
}
