import type { UiPluginInfo, UiPluginsConfig } from "@tcode/shared";
import { create } from "zustand";
import { getPi } from "../api";

export const EMPTY_PLUGINS: UiPluginInfo[] = [];

interface UiPluginsStore {
	config: UiPluginsConfig;
	plugins: UiPluginInfo[];

	loadErrors: Record<string, string>;

	loadAll: () => Promise<void>;

	setMaster: (enabled: boolean) => Promise<void>;

	setPluginEnabled: (name: string, enabled: boolean) => Promise<void>;

	assignSlot: (slot: string, pluginName: string | null) => Promise<void>;

	rebuild: (name: string) => Promise<void>;

	openDir: (name?: string) => Promise<void>;
	setLoadError: (name: string, error?: string) => void;
}

export const useUiPluginsStore = create<UiPluginsStore>((set, get) => ({
	config: { enabled: false, plugins: {}, assignments: {} },
	plugins: EMPTY_PLUGINS,
	loadErrors: {},
	loadAll: async () => {
		try {
			const [config, plugins] = await Promise.all([getPi().uiPluginsGetConfig(), getPi().uiPluginsList()]);
			set({ config, plugins });
		} catch (err) {
			console.error("[ui-plugins] loadAll failed", err);
		}
	},
	setMaster: async (enabled) => {
		await getPi().uiPluginsSetEnabled({ enabled });
		await get().loadAll();
	},
	setPluginEnabled: async (name, enabled) => {
		await getPi().uiPluginsSetPluginEnabled({ name, enabled });
		await get().loadAll();
	},
	assignSlot: async (slot, pluginName) => {
		await getPi().uiPluginsAssignSlot({ slot, pluginName });
		await get().loadAll();
	},
	rebuild: async (name) => {
		await getPi().uiPluginsRebuild({ name });
		await get().loadAll();
	},
	openDir: async (name) => {
		await getPi().uiPluginsOpenDir({ name });
	},
	setLoadError: (name, error) => {
		set((state) => {
			const loadErrors = { ...state.loadErrors };
			if (error === undefined) delete loadErrors[name];
			else loadErrors[name] = error;
			return { loadErrors };
		});
	},
}));
