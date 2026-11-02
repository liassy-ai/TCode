import { useRef } from "react";
import { useSidebarFill } from "../../hooks/use-sidebar-fill";
import { useT } from "../../i18n";
import { EMPTY_CONTRIBUTIONS } from "../../plugins/RegionHost";
import { useUiPluginRegistry } from "../../plugins/registry";
import { UI_REGIONS } from "../../plugins/slots";
import { useSettingsStore } from "../../stores/settings";
import { useUiPluginsStore } from "../../stores/ui-plugins";
import { useUiPreferencesStore } from "../../stores/ui-preferences";
import {
	ArrowLeftIcon,
	FolderIcon,
	GridIcon,
	InfoIcon,
	PlugIcon,
	RefreshIcon,
	SlidersIcon,
	SparkleIcon,
} from "../icons";
import { SidebarResizer } from "../sidebar/SidebarResizer";
import { pluginCategoryId, STATIC_CATEGORIES } from "./catalog";

export function SettingsNav() {
	const t = useT();
	const category = useSettingsStore((s) => s.category);
	const setCategory = useSettingsStore((s) => s.setCategory);
	const setOpen = useSettingsStore((s) => s.setOpen);

	const collapsed = useUiPreferencesStore((s) => s.sidebarCollapsed);
	const asideRef = useRef<HTMLElement | null>(null);
	useSidebarFill(asideRef, false);

	const masterOn = useUiPluginsStore((s) => s.config.enabled);
	const registryCategories = useUiPluginRegistry((s) => s.contributions[UI_REGIONS.SettingsPanel]);
	const pluginCategories = masterOn ? (registryCategories ?? EMPTY_CONTRIBUTIONS) : EMPTY_CONTRIBUTIONS;

	const itemClass = (active: boolean) =>
		`flex w-full items-center gap-2 rounded-full px-3 py-2 text-left text-[13.5px] transition-colors ${
			active ? "bg-hover font-medium text-ink" : "text-ink-dim hover:bg-hover hover:text-ink"
		}`;

	const CATEGORY_ICONS = {
		general: SlidersIcon,
		models: SparkleIcon,
		mcp: PlugIcon,
		extensions: GridIcon,
		archive: FolderIcon,
		update: RefreshIcon,
		about: InfoIcon,
	} as const;

	return (
		<div
			ref={asideRef as React.RefObject<HTMLDivElement>}
			className={`sidebar ${collapsed ? "is-collapsed" : ""}`}
		>
			<div className="sidebar-inner flex h-full flex-col">
				{}
				<div className="flex shrink-0 flex-col px-2.5 pt-2.5 pb-1">
					<button
						type="button"
						className="flex h-9 w-full items-center gap-2 rounded-full px-3 text-[14px] font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink"
						onClick={() => setOpen(false)}
					>
						<ArrowLeftIcon size={17} className="shrink-0" />
						<span className="min-w-0 flex-1 truncate text-left">{t("settings.backToChat")}</span>
					</button>
				</div>
				<nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-2">
					{STATIC_CATEGORIES.map((id) => {
						const Icon = CATEGORY_ICONS[id];
						return (
							<button
								key={id}
								type="button"
								className={itemClass(category === id)}
								onClick={() => setCategory(id)}
							>
								<span className="grid h-[18px] w-[18px] shrink-0 place-items-center" aria-hidden="true">
									<Icon size={17} />
								</span>
								<span className="min-w-0 flex-1 truncate">{t(`settings.category.${id}`)}</span>
							</button>
						);
					})}

					{pluginCategories.map((c) => {
						const id = pluginCategoryId(c.pluginName, c.id);
						return (
							<button
								key={id}
								type="button"
								className={itemClass(category === id)}
								onClick={() => setCategory(id)}
							>
								<span className="grid h-[18px] w-[18px] shrink-0 place-items-center" aria-hidden="true">
									<GridIcon size={17} />
								</span>
								<span className="min-w-0 flex-1 truncate">{c.title ?? c.pluginName}</span>
							</button>
						);
					})}
				</nav>
			</div>
			{}
			{!collapsed && <SidebarResizer asideRef={asideRef} />}
		</div>
	);
}
