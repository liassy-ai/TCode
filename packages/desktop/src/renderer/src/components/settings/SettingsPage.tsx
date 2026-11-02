import { useMemo } from "react";
import { useT } from "../../i18n";
import { PluginBoundary } from "../../plugins/PluginBoundary";
import { EMPTY_CONTRIBUTIONS } from "../../plugins/RegionHost";
import { useUiPluginRegistry } from "../../plugins/registry";
import { UI_REGIONS } from "../../plugins/slots";
import { useSettingsStore } from "../../stores/settings";
import { useUiPluginsStore } from "../../stores/ui-plugins";
import { findPluginContribution, SETTINGS_PANELS } from "./catalog";

export function SettingsPage() {
	const t = useT();
	const category = useSettingsStore((s) => s.category);

	const masterOn = useUiPluginsStore((s) => s.config.enabled);
	const registryCategories = useUiPluginRegistry((s) => s.contributions[UI_REGIONS.SettingsPanel]);
	const pluginCategories = masterOn ? (registryCategories ?? EMPTY_CONTRIBUTIONS) : EMPTY_CONTRIBUTIONS;
	const pluginNonces = useUiPluginRegistry((s) => s.loadNonces);

	const activePluginContribution = useMemo(
		() => findPluginContribution(category, pluginCategories),
		[category, pluginCategories],
	);

	const Panel = SETTINGS_PANELS[category];

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="mx-auto min-h-0 w-full max-w-[760px] flex-1 overflow-y-auto overflow-x-hidden px-4 pb-3">
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
	);
}
