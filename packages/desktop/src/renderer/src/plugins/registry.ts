import type { UiPluginAnchor, UiPluginManifest } from "@tcode/shared";
import type { ComponentType } from "react";
import { create } from "zustand";
import type { SlotName } from "./slots";

export const CRASH_THRESHOLD = 3;

const REACT_WRAPPED_TYPES = new Set([
	Symbol.for("react.memo"),
	Symbol.for("react.forward_ref"),
	Symbol.for("react.lazy"),
]);

function isComponent(exported: unknown): boolean {
	if (typeof exported === "function") return true;
	return (
		typeof exported === "object" &&
		exported !== null &&
		REACT_WRAPPED_TYPES.has((exported as { $$typeof?: symbol }).$$typeof as symbol)
	);
}

export interface SlotOverride {
	pluginName: string;

	exportName: string;

	component: ComponentType<never>;
}

export interface Contribution {
	pluginName: string;

	id: string;

	exportName: string;

	component: ComponentType<Record<string, never>>;

	anchor?: UiPluginAnchor;

	title?: string;
}

interface UiPluginRegistryState {
	overrides: Partial<Record<SlotName, SlotOverride>>;

	contributions: Record<string, Contribution[]>;

	crashCounts: Record<string, number>;

	cleanups: Record<string, () => void>;

	loadNonces: Record<string, number>;

	applyPlugin(
		manifest: UiPluginManifest,
		module: Record<string, unknown>,
		assignedSlots: SlotName[],
	): { ok: boolean; missing: string[] };

	removePlugin(pluginName: string): void;

	reportCrash(pluginName: string): boolean;
}

export const useUiPluginRegistry = create<UiPluginRegistryState>((set, get) => ({
	overrides: {},
	contributions: {},
	crashCounts: {},
	cleanups: {},
	loadNonces: {},
	applyPlugin: (manifest, module, assignedSlots) => {
		const missing: string[] = [];

		const prevCleanup = get().cleanups[manifest.name];
		if (prevCleanup) {
			try {
				prevCleanup();
			} catch (err) {
				console.error(`[ui-plugins] ${manifest.name} 旧 cleanup 抛错`, err);
			}
		}
		let cleanup: (() => void) | undefined;
		if (manifest.headless) {
			const activate = module.activate;
			if (typeof activate !== "function") {
				missing.push("headless → activate");
			} else {
				try {
					const ret = activate();
					if (typeof ret === "function") cleanup = ret;
				} catch (err) {
					console.error(`[ui-plugins] ${manifest.name} activate 抛错`, err);
					missing.push("headless activate 异常");
				}
			}
		}

		const overrides = { ...get().overrides };
		for (const slot of assignedSlots) {
			const exportName = manifest.slots?.[slot];
			if (!exportName) continue;
			const exported = module[exportName];
			if (!isComponent(exported)) {
				missing.push(`${slot} → ${exportName}`);
				continue;
			}
			overrides[slot] = {
				pluginName: manifest.name,
				exportName,
				component: exported as ComponentType<never>,
			};
		}

		const contributions = { ...get().contributions };
		for (const c of manifest.contributions ?? []) {
			const exported = module[c.export];
			if (!isComponent(exported)) {
				missing.push(`${c.region}#${c.id} → ${c.export}`);
				continue;
			}
			const list = contributions[c.region] ?? [];
			contributions[c.region] = [
				...list,
				{
					pluginName: manifest.name,
					id: c.id,
					exportName: c.export,
					component: exported as ComponentType<Record<string, never>>,
					anchor: c.anchor,
					title: c.title,
				},
			];
		}
		const loadNonces = {
			...get().loadNonces,
			[manifest.name]: (get().loadNonces[manifest.name] ?? 0) + 1,
		};
		const cleanups = { ...get().cleanups };
		if (cleanup) cleanups[manifest.name] = cleanup;
		else delete cleanups[manifest.name];
		set({ overrides, contributions, loadNonces, cleanups });
		return { ok: missing.length === 0, missing };
	},
	removePlugin: (pluginName) => {
		const overrides = { ...get().overrides };
		for (const slot of Object.keys(overrides) as SlotName[]) {
			if (overrides[slot]?.pluginName === pluginName) delete overrides[slot];
		}
		const contributions = { ...get().contributions };
		for (const region of Object.keys(contributions)) {
			const list = contributions[region];
			if (!list) continue;
			const filtered = list.filter((c) => c.pluginName !== pluginName);
			if (filtered.length === 0) delete contributions[region];
			else contributions[region] = filtered;
		}
		const crashCounts = { ...get().crashCounts };
		delete crashCounts[pluginName];

		const cleanup = get().cleanups[pluginName];
		if (cleanup) {
			try {
				cleanup();
			} catch (err) {
				console.error(`[ui-plugins] ${pluginName} cleanup 抛错`, err);
			}
		}
		const cleanups = { ...get().cleanups };
		delete cleanups[pluginName];

		set({ overrides, contributions, crashCounts, cleanups });
	},
	reportCrash: (pluginName) => {
		const count = (get().crashCounts[pluginName] ?? 0) + 1;
		set({ crashCounts: { ...get().crashCounts, [pluginName]: count } });
		return count >= CRASH_THRESHOLD;
	},
}));
