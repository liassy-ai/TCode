import type { SidebarBackground, ThemeMode } from "@tcode/shared";
import { useState } from "react";
import { useT } from "../../i18n";
import { backgroundImageUrl, useThemeStore } from "../../stores/theme";
import { useUiPreferencesStore } from "../../stores/ui-preferences";
import { MonitorIcon, MoonIcon, SunIcon } from "../icons";
import { Switch } from "../ui/Switch";
import { UiPluginsSection } from "./UiPluginsSection";

const THEME_MODES: ThemeMode[] = ["light", "dark", "system"];
const THEME_ICONS = { light: SunIcon, dark: MoonIcon, system: MonitorIcon } as const;

const SIDEBAR_BACKGROUNDS: SidebarBackground[] = ["soft", "deep", "translucent"];
const SIDEBAR_BACKGROUND_LABEL_KEYS = {
	light: {
		soft: "settings.sidebarBackgroundLightSoft",
		deep: "settings.sidebarBackgroundLightDeep",
		translucent: "settings.sidebarBackgroundTranslucent",
	},
	dark: {
		soft: "settings.sidebarBackgroundDarkSoft",
		deep: "settings.sidebarBackgroundDarkDeep",
		translucent: "settings.sidebarBackgroundTranslucent",
	},
} as const;
const THEME_LABEL_KEYS = {
	light: "settings.themeLight",
	dark: "settings.themeDark",
	system: "settings.themeSystem",
} as const;

export type AppearanceTab = "basics" | "uiPlugins";

export const APPEARANCE_TABS = [
	{ id: "basics", labelKey: "settings.appearance.tabBasics" },
	{ id: "uiPlugins", labelKey: "settings.appearance.tabUiPlugins" },
] as const;

function AppearanceBasics() {
	const t = useT();
	const mode = useThemeStore((s) => s.mode);
	const setMode = useThemeStore((s) => s.setMode);
	const background = useThemeStore((s) => s.background);
	const pickBackground = useThemeStore((s) => s.pickBackground);
	const clearBackground = useThemeStore((s) => s.clearBackground);
	const setBackgroundDim = useThemeStore((s) => s.setBackgroundDim);
	const barSessionsVisible = useUiPreferencesStore((s) => s.barSessionsVisible);
	const setBarSessionsVisible = useUiPreferencesStore((s) => s.setBarSessionsVisible);
	const sessionRailEnabled = useUiPreferencesStore((s) => s.sessionRailEnabled);
	const setSessionRailEnabled = useUiPreferencesStore((s) => s.setSessionRailEnabled);
	const sidebarBackground = useUiPreferencesStore((s) => s.sidebarBackground);
	const setSidebarBackground = useUiPreferencesStore((s) => s.setSidebarBackground);
	const resolvedTheme = useThemeStore((s) => s.resolved);

	return (
		<div className="flex flex-col gap-6">
			<div>
				<h3 className="text-[13px] font-medium text-ink">{t("settings.theme")}</h3>
				<p className="mt-0.5 text-[11px] text-ink-faint">{t("settings.themeHint")}</p>
				<fieldset className="mt-2 grid min-w-0 grid-cols-3 gap-2" aria-label={t("settings.theme")}>
					{THEME_MODES.map((m) => {
						const Icon = THEME_ICONS[m];
						return (
							<button
								key={m}
								type="button"
								aria-pressed={mode === m}
								className={`flex min-h-[88px] min-w-0 flex-col items-center justify-center gap-2 rounded-xl border px-2 py-4 text-[13px] transition-colors ${
									mode === m
										? "border-ink-faint bg-hover text-ink"
										: "border-border text-ink-2 hover:border-border-strong hover:bg-hover"
								}`}
								onClick={() => setMode(m)}
							>
								<Icon size={20} />
								{t(THEME_LABEL_KEYS[m])}
							</button>
						);
					})}
				</fieldset>
			</div>
			<div>
				<h3 className="text-[13px] font-medium text-ink">{t("settings.background")}</h3>
				<p className="mt-0.5 text-[11px] text-ink-faint">{t("settings.backgroundHint")}</p>
				<div className="mt-2 flex items-center gap-3">
					{background.image ? (
						<img
							src={backgroundImageUrl(background.image)}
							alt=""
							className="h-16 w-28 rounded-lg border border-border object-cover"
						/>
					) : (
						<div className="flex h-16 w-28 items-center justify-center rounded-lg border border-dashed border-border text-[11px] text-ink-faint">
							—
						</div>
					)}
					<div className="flex gap-2">
						<button
							type="button"
							className="rounded-lg border border-border px-3 py-1.5 text-[13px] text-ink-2 transition-colors hover:border-border-strong hover:bg-hover"
							onClick={() => void pickBackground()}
						>
							{t(background.image ? "settings.backgroundChange" : "settings.backgroundPick")}
						</button>
						{background.image && (
							<button
								type="button"
								className="rounded-lg px-3 py-1.5 text-[13px] text-red-500 transition-colors hover:bg-red-50"
								onClick={clearBackground}
							>
								{t("settings.backgroundClear")}
							</button>
						)}
					</div>
				</div>
				{background.image && (
					<div className="mt-3 flex items-center gap-3">
						<span className="w-20 shrink-0 text-[12px] text-ink-dim">{t("settings.backgroundDim")}</span>
						<input
							type="range"
							min={20}
							max={100}
							value={Math.round(background.dim * 100)}
							onChange={(e) => setBackgroundDim(Number(e.target.value) / 100)}
							className="h-1 flex-1 accent-ink"
							aria-label={t("settings.backgroundDim")}
						/>
						<span className="w-10 shrink-0 text-right text-[12px] tabular-nums text-ink-dim">
							{Math.round(background.dim * 100)}%
						</span>
					</div>
				)}
			</div>
			<div>
				<h3 className="text-[13px] font-medium text-ink">{t("settings.sidebarBackground")}</h3>
				<p className="mt-0.5 text-[11px] text-ink-faint">{t("settings.sidebarBackgroundHint")}</p>
				<div className="mt-2 flex gap-2">
					{SIDEBAR_BACKGROUNDS.map((value) => (
						<button
							key={value}
							type="button"
							className={`rounded-lg border px-3 py-1.5 text-[13px] transition-colors ${
								sidebarBackground === value
									? "border-ink bg-ink text-on-ink"
									: "border-border text-ink-2 hover:border-border-strong hover:bg-hover"
							}`}
							aria-pressed={sidebarBackground === value}
							onClick={() => setSidebarBackground(value)}
						>
							{t(SIDEBAR_BACKGROUND_LABEL_KEYS[resolvedTheme][value])}
						</button>
					))}
				</div>
			</div>
			<div>
				<div className="flex items-center justify-between gap-4">
					<h3 className="text-[13px] font-medium text-ink">{t("settings.topBar")}</h3>
					<Switch checked={barSessionsVisible} onCheckedChange={setBarSessionsVisible} />
				</div>
				<p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">{t("settings.topBarHint")}</p>
			</div>
			<div>
				<div className="flex items-center justify-between gap-4">
					<h3 className="text-[13px] font-medium text-ink">{t("settings.sessionRail")}</h3>
					<Switch checked={sessionRailEnabled} onCheckedChange={setSessionRailEnabled} />
				</div>
				<p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">{t("settings.sessionRailHint")}</p>
			</div>
		</div>
	);
}

export function AppearancePanel({ tab: controlledTab }: { tab?: AppearanceTab } = {}) {
	const t = useT();
	const [ownTab, setOwnTab] = useState<AppearanceTab>("basics");
	const tab = controlledTab ?? ownTab;

	return (
		<div>
			{controlledTab === undefined && (
				<div className="flex gap-5 px-0.5 pt-0.5">
					{APPEARANCE_TABS.map((tabDef) => (
						<button
							key={tabDef.id}
							type="button"
							className={`relative -mb-px border-b-2 px-0.5 pb-[9px] pt-[5px] text-[13px] transition-colors ${
								tab === tabDef.id
									? "border-ink font-medium text-ink"
									: "border-transparent text-ink-faint hover:text-ink-2"
							}`}
							onClick={() => setOwnTab(tabDef.id)}
						>
							{t(tabDef.labelKey)}
						</button>
					))}
				</div>
			)}
			<div className={controlledTab === undefined ? "pt-5" : ""}>
				{tab === "basics" ? <AppearanceBasics /> : <UiPluginsSection />}
			</div>
		</div>
	);
}
