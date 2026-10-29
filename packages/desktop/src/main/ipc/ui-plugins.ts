import { IpcChannels, KNOWN_UI_SLOTS, UI_PLUGINS_CHANNELS, type UiPluginsConfig } from "@tcode/shared";
import { shell } from "electron";
import { loadUiPluginsConfig } from "../ui-plugins/config";
import type { UiPluginManager } from "../ui-plugins/manager";
import { sendToRenderer } from "./index";
import { registerInvokeHandlers } from "./invoke";

function pushConfigEvent(): void {
	sendToRenderer(IpcChannels.UiPluginsEvent, { kind: "config" });
}

export function registerUiPluginsIpc(manager: UiPluginManager): void {
	registerInvokeHandlers(UI_PLUGINS_CHANNELS, {
		uiPluginsGetConfig: () => loadUiPluginsConfig(),

		uiPluginsSetEnabled: async ({ enabled }) => {
			if (typeof enabled !== "boolean") return;
			await manager.updateConfig({ enabled });
			pushConfigEvent();
		},
		uiPluginsList: () => manager.list(),

		uiPluginsReadCode: ({ name }) => {
			if (typeof name !== "string" || name.length === 0) return { error: "参数非法" };
			return manager.readCode(name);
		},
		uiPluginsSetPluginEnabled: async ({ name, enabled }) => {
			if (typeof name !== "string" || typeof enabled !== "boolean") return;
			const info = manager.info(name);
			if (!info || info.invalidReason) return;
			const config = await loadUiPluginsConfig();
			const prev = config.plugins[name];
			const patch: Partial<UiPluginsConfig> = {
				plugins: {
					...config.plugins,
					[name]: { enabled, trusted: enabled ? true : (prev?.trusted ?? false) },
				},
			};
			await manager.updateConfig(patch);
			pushConfigEvent();
		},
		uiPluginsAssignSlot: async ({ slot, pluginName }) => {
			if (typeof slot !== "string" || !KNOWN_UI_SLOTS.includes(slot)) return;
			if (pluginName !== null && typeof pluginName !== "string") return;
			const config = await loadUiPluginsConfig();
			const assignments = { ...config.assignments };
			if (pluginName === null) delete assignments[slot];
			else assignments[slot] = pluginName;
			await manager.updateConfig({ assignments });
			pushConfigEvent();
		},
		uiPluginsRebuild: async ({ name }) => {
			if (typeof name !== "string" || name.length === 0) return { ok: false as const, error: "参数非法" };
			const ok = await manager.ensureBuilt(name, true);
			if (!ok) {
				const info = manager.info(name);
				return { ok: false as const, error: info?.buildError ?? "构建失败" };
			}

			sendToRenderer(IpcChannels.UiPluginsEvent, { kind: "changed", name });
			return { ok: true as const };
		},
		uiPluginsOpenDir: ({ name }) => {
			if (name !== undefined && name !== null && typeof name !== "string") return;
			const dir = typeof name === "string" ? manager.pluginDirOf(name) : manager.rootDir();
			if (!dir) return;
			void shell.openPath(dir);
		},
	});
}
