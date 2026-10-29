import { type FSWatcher, mkdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@tcode/backend";
import { app } from "electron";

const log = createLogger("managed-config");

function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
}

type Orig = { had: boolean; value?: unknown };

export class ManagedConfig {
	private watcher: FSWatcher | null = null;
	private onChange: (() => void) | null = null;
	private lastPatchKey = "";

	setEmitter(fn: () => void): void {
		this.onChange = fn;
	}

	start(): void {
		const dir = app.getPath("userData");
		const file = join(dir, "managed-config.json");
		this.apply(file);
		try {
			this.watcher = watch(dir, (_event, filename) => {
				if (filename && filename.toString() === "managed-config.json") this.apply(file);
			});
		} catch (e) {
			log.warn("无法监听 managed-config.json", (e as Error).message);
		}
	}

	private statePath(): string {
		return join(app.getPath("userData"), "managed-config.state.json");
	}

	private loadState(): Record<string, Orig> {
		try {
			return JSON.parse(readFileSync(this.statePath(), "utf8")) as Record<string, Orig>;
		} catch {
			return {};
		}
	}

	private saveState(state: Record<string, Orig>): void {
		try {
			writeFileSync(this.statePath(), `${JSON.stringify(state, null, 2)}\n`, "utf8");
		} catch (e) {
			log.warn("写入 managed-config 状态失败", (e as Error).message);
		}
	}

	private apply(file: string): void {
		let raw = "";
		try {
			raw = readFileSync(file, "utf8");
		} catch {
			raw = "";
		}
		let patch: Record<string, unknown> = {};
		if (raw.trim()) {
			try {
				patch = JSON.parse(raw) as Record<string, unknown>;
			} catch {
				log.warn("managed-config.json 解析失败");
				return;
			}
		}
		const patchKey = JSON.stringify(patch);
		if (patchKey === this.lastPatchKey) return;

		const settingsPath = join(agentDir(), "settings.json");
		let current: Record<string, unknown> = {};
		try {
			current = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
		} catch {
			current = {};
		}
		const state = this.loadState();
		const has = (o: object, k: string) => Object.hasOwn(o, k);

		for (const k of Object.keys(state)) {
			if (!has(patch, k)) {
				const orig = state[k];
				if (!orig) {
					delete state[k];
					continue;
				}
				if (orig.had) current[k] = orig.value;
				else delete current[k];
				delete state[k];
			}
		}

		for (const k of Object.keys(patch)) {
			if (!has(state, k)) {
				state[k] = has(current, k) ? { had: true, value: current[k] } : { had: false };
			}
			current[k] = patch[k];
		}

		try {
			mkdirSync(agentDir(), { recursive: true });
			writeFileSync(settingsPath, `${JSON.stringify(current, null, 2)}\n`, "utf8");
			this.saveState(state);
			this.lastPatchKey = patchKey;
			log.info("managed-config 已应用", { keys: Object.keys(patch) });
			this.onChange?.();
		} catch (e) {
			log.warn("managed-config 写入失败", (e as Error).message);
		}
	}

	stop(): void {
		this.watcher?.close();
		this.watcher = null;
	}
}
