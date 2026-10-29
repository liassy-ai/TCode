import type { ComponentType } from "react";
import { useMemo } from "react";
import { useT } from "../../i18n";
import { PluginBoundary } from "../../plugins/PluginBoundary";
import { EMPTY_CONTRIBUTIONS } from "../../plugins/RegionHost";
import { type Contribution, useUiPluginRegistry } from "../../plugins/registry";
import { UI_REGIONS } from "../../plugins/slots";
import { type SettingsCategory, useSettingsStore } from "../../stores/settings";
import { useUiPluginsStore } from "../../stores/ui-plugins";
import { AboutPanel } from "./AboutPanel";
import { ArchivePanel } from "./ArchivePanel";
import { BugReportPanel } from "./BugReportPanel";
import { ExtensionsPanel } from "./extensions/ExtensionsPanel";
import { GeneralPanel } from "./GeneralPanel";
import { ProvidersPanel } from "./providers/ProvidersPanel";
import { UpdatePanel } from "./UpdatePanel";

const STATIC_CATEGORIES = [
	"general",
	"models",
	"extensions",
	"archive",
	"update",
	"bug",
	"about",
] as const satisfies readonly SettingsCategory[];

const PANELS: Partial<Record<SettingsCategory, ComponentType>> = {
	general: GeneralPanel,
	models: ProvidersPanel,
	extensions: ExtensionsPanel,
	archive: ArchivePanel,
	update: UpdatePanel,
	bug: BugReportPanel,
	about: AboutPanel,
};

function pluginCategoryId(pluginName: string, contributionId: string): SettingsCategory {
	return `plugin:${pluginName}:${contributionId}`;
}

function findPluginContribution(category: SettingsCategory, list: Contribution[] | undefined) {
	if (!category.startsWith("plugin:")) return null;
	const rest = category.slice("plugin:".length);
	const sep = rest.indexOf(":");
	if (sep < 0) return null;
	const pluginName = rest.slice(0, sep);
	const contributionId = rest.slice(sep + 1);
	return list?.find((c) => c.pluginName === pluginName && c.id === contributionId) ?? null;
}

export function SettingsDialog() {
	const t = useT();
	const open = useSettingsStore((s) => s.open);
	const setOpen = useSettingsStore((s) => s.setOpen);
	const category = useSettingsStore((s) => s.category);
	const setCategory = useSettingsStore((s) => s.setCategory);

	const masterOn = useUiPluginsStore((s) => s.config.enabled);
	const registryCategories = useUiPluginRegistry((s) => s.contributions[UI_REGIONS.SettingsPanel]);
	const pluginCategories = masterOn ? (registryCategories ?? EMPTY_CONTRIBUTIONS) : EMPTY_CONTRIBUTIONS;

	const pluginNonces = useUiPluginRegistry((s) => s.loadNonces);

	const activePluginContribution = useMemo(
		() => findPluginContribution(category, pluginCategories),
		[category, pluginCategories],
	);

	if (!open) return null;

	const Panel = PANELS[category];

	return (
		<div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/20" role="dialog" aria-modal>
			<div className="flex h-[70vh] max-h-[calc(100dvh-24px)] w-[720px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-dialog">
				<div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
					<h2 className="text-sm font-semibold text-ink">{t("settings.title")}</h2>
					<button
						type="button"
						className="rounded-lg px-2 py-1 text-ink-faint transition-colors hover:bg-hover hover:text-ink-2"
						onClick={() => setOpen(false)}
						aria-label={t("common.close")}
					>
						✕
					</button>
				</div>
				<div className="flex min-h-0 flex-1 flex-col sm:flex-row">
					<nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border p-2 sm:w-44 sm:flex-col sm:items-stretch sm:gap-0 sm:overflow-y-auto sm:border-b-0 sm:border-r">
						{STATIC_CATEGORIES.map((id) => (
							<button
								key={id}
								type="button"
								className={`shrink-0 rounded-lg px-3 py-2 text-left text-[13px] whitespace-nowrap transition-colors sm:mb-0.5 sm:w-full sm:whitespace-normal ${
									category === id
										? "bg-hover font-medium text-ink"
										: "text-ink-dim hover:bg-hover hover:text-ink"
								}`}
								onClick={() => setCategory(id)}
							>
								{t(`settings.category.${id}`)}
							</button>
						))}

						{pluginCategories.map((c) => {
							const id = pluginCategoryId(c.pluginName, c.id);
							return (
								<button
									key={id}
									type="button"
									className={`shrink-0 rounded-lg px-3 py-2 text-left text-[13px] whitespace-nowrap transition-colors sm:mb-0.5 sm:w-full sm:whitespace-normal ${
										category === id
											? "bg-hover font-medium text-ink"
											: "text-ink-dim hover:bg-hover hover:text-ink"
									}`}
									onClick={() => setCategory(id)}
								>
									{c.title ?? c.pluginName}
								</button>
							);
						})}
					</nav>
					<div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-3">
						{Panel ? (
							<Panel />
						) : activePluginContribution ? (
							<PluginBoundary
								key={`${activePluginContribution.pluginName}:${activePluginContribution.id}:${
									pluginNonces[activePluginContribution.pluginName] ?? 0
								}`}
								pluginName={activePluginContribution.pluginName}
								label={category}
							>
								<activePluginContribution.component />
							</PluginBoundary>
						) : (
							<p className="py-8 text-center text-[13px] text-ink-faint">{t("settings.comingSoon")}</p>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
