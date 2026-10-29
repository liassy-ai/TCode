import {
	KNOWN_UI_SLOTS,
	type UiPluginInfo,
	type UiPluginManifest,
	type UiPluginsConfig,
} from "@tcode/shared";
import { getPi } from "../api";
import { useUiPluginsStore } from "../stores/ui-plugins";
import { useUiPluginRegistry } from "./registry";
import type { SlotName } from "./slots";

function computeAssignedSlots(
	manifest: UiPluginManifest,
	allPlugins: UiPluginInfo[],
	config: UiPluginsConfig,
): SlotName[] {
	const out: SlotName[] = [];
	for (const slot of Object.keys(manifest.slots ?? {}) as SlotName[]) {
		if (!KNOWN_UI_SLOTS.includes(slot)) continue;
		const contenders = allPlugins.filter(
			(p) => p.enabled && !p.invalidReason && !p.buildError && p.slots[slot] !== undefined,
		);
		const assigned = config.assignments[slot];
		if (assigned === manifest.name) {
			out.push(slot);
		} else if (assigned === undefined && contenders.length === 1 && contenders[0]?.name === manifest.name) {
			out.push(slot);
		}
	}
	return out;
}

async function loadPluginCode(
	manifest: UiPluginManifest,
	code: string,
	assignedSlots: SlotName[],
): Promise<void> {
	const blob = new Blob([code], { type: "text/javascript" });
	const url = URL.createObjectURL(blob);
	try {
		const module = await import(/* @vite-ignore */ url);

		useUiPluginRegistry.getState().removePlugin(manifest.name);
		const res = useUiPluginRegistry
			.getState()
			.applyPlugin(manifest, module as Record<string, unknown>, assignedSlots);
		if (!res.ok) {
			console.warn(`[ui-plugins] ${manifest.name} 部分槽位导出缺失:`, res.missing);
		}
		useUiPluginsStore.getState().setLoadError(manifest.name);
	} catch (err) {
		console.error(`[ui-plugins] ${manifest.name} 代码加载失败`, err);
		useUiPluginsStore.getState().setLoadError(manifest.name, String(err));
	} finally {
		URL.revokeObjectURL(url);
	}
}

async function reloadAll(): Promise<void> {
	const store = useUiPluginsStore.getState();
	await store.loadAll();
	const { config, plugins } = useUiPluginsStore.getState();

	const registeredNames = new Set<string>();
	const registered = useUiPluginRegistry.getState().overrides;
	for (const slot of Object.keys(registered) as SlotName[]) {
		const name = registered[slot]?.pluginName;
		if (name) registeredNames.add(name);
	}
	const registeredContributions = useUiPluginRegistry.getState().contributions;
	for (const region of Object.keys(registeredContributions)) {
		for (const c of registeredContributions[region] ?? []) registeredNames.add(c.pluginName);
	}
	for (const name of registeredNames) useUiPluginRegistry.getState().removePlugin(name);
	for (const p of plugins) {
		if (!p.enabled || !p.trusted || p.invalidReason || p.buildError) continue;
		const res = await getPi().uiPluginsReadCode({ name: p.name });
		if ("error" in res) {
			console.warn(`[ui-plugins] ${p.name} 读代码失败:`, res.error);
			store.setLoadError(p.name, res.error);
			continue;
		}
		await loadPluginCode(res.manifest, res.code, computeAssignedSlots(res.manifest, plugins, config));
	}
}

async function reloadPlugin(name: string): Promise<void> {
	await useUiPluginsStore.getState().loadAll();
	const { config, plugins } = useUiPluginsStore.getState();
	const p = plugins.find((x) => x.name === name);
	if (!p?.enabled || !p.trusted || p.invalidReason || p.buildError) return;
	const res = await getPi().uiPluginsReadCode({ name });
	if ("error" in res) {
		console.warn(`[ui-plugins] ${name} 读代码失败:`, res.error);
		useUiPluginsStore.getState().setLoadError(name, res.error);
		return;
	}
	await loadPluginCode(res.manifest, res.code, computeAssignedSlots(res.manifest, plugins, config));
}

let subscribed = false;

let reloadChain: Promise<void> = Promise.resolve();
function enqueueReload(fn: () => Promise<void>): void {
	reloadChain = reloadChain.then(fn, fn);
}

export async function initUiPlugins(): Promise<void> {
	if (!subscribed) {
		subscribed = true;
		getPi().onUiPluginsEvent((payload) => {
			if (payload.kind === "config") enqueueReload(() => reloadAll());
			else if (payload.kind === "changed") enqueueReload(() => reloadPlugin(payload.name));
		});
	}
	await useUiPluginsStore.getState().loadAll();
	const { config } = useUiPluginsStore.getState();
	if (!config.enabled) return;
	await reloadAll();
}
