import type { ComponentType } from "react";
import type { Contribution } from "../../plugins/registry";
import type { SettingsCategory } from "../../stores/settings";
import { AboutPanel } from "./AboutPanel";
import { ArchivePanel } from "./ArchivePanel";
import { ExtensionsPanel } from "./extensions/ExtensionsPanel";
import { GeneralPanel } from "./GeneralPanel";
import { McpPanel } from "./McpPanel";
import { ProvidersPanel } from "./providers/ProvidersPanel";
import { UpdatePanel } from "./UpdatePanel";

export const STATIC_CATEGORIES = [
	"general",
	"models",
	"mcp",
	"extensions",
	"archive",
	"update",
	"about",
] as const satisfies readonly SettingsCategory[];

export const SETTINGS_PANELS: Partial<Record<SettingsCategory, ComponentType>> = {
	general: GeneralPanel,
	models: ProvidersPanel,
	mcp: McpPanel,
	extensions: ExtensionsPanel,
	archive: ArchivePanel,
	update: UpdatePanel,
	about: AboutPanel,
};

export type StaticCategory = (typeof STATIC_CATEGORIES)[number];

export function toStaticCategory(category: SettingsCategory): StaticCategory | null {
	return (STATIC_CATEGORIES as readonly string[]).includes(category) ? (category as StaticCategory) : null;
}

export function pluginCategoryId(pluginName: string, contributionId: string): SettingsCategory {
	return `plugin:${pluginName}:${contributionId}`;
}

export function findPluginContribution(category: SettingsCategory, list: Contribution[] | undefined) {
	if (!category.startsWith("plugin:")) return null;
	const rest = category.slice("plugin:".length);
	const sep = rest.indexOf(":");
	if (sep < 0) return null;
	const pluginName = rest.slice(0, sep);
	const contributionId = rest.slice(sep + 1);
	return list?.find((c) => c.pluginName === pluginName && c.id === contributionId) ?? null;
}
