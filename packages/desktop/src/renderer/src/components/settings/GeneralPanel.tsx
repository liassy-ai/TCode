import type { ContextManagerMode } from "@tcode/shared";
import { useEffect, useState } from "react";
import type { LanguageMode } from "../../i18n";
import { useI18nStore, useT } from "../../i18n";
import { useSettingsStore } from "../../stores/settings";
import { pushToast } from "../../stores/toasts";
import { useUiPreferencesStore } from "../../stores/ui-preferences";
import { Switch } from "../ui/Switch";
import { APPEARANCE_TABS, AppearancePanel, type AppearanceTab } from "./AppearancePanel";
import { WebAccessPanel } from "./WebAccessPanel";

const CONTEXT_MANAGER_MODES: ContextManagerMode[] = ["evaporation", "off"];

const LANGUAGE_MODES: LanguageMode[] = ["zh", "en", "chat-en"];

type GeneralSettingsTab = "general" | AppearanceTab | "web";

export function GeneralPanel() {
	const [tab, setTab] = useState<GeneralSettingsTab>("general");

	const tabHint = useSettingsStore((s) => s.generalTabHint);
	useEffect(() => {
		if (!tabHint) return;
		setTab(tabHint as GeneralSettingsTab);
		useSettingsStore.getState().setGeneralTabHint(null);
	}, [tabHint]);
	const t = useT();
	const language = useI18nStore((s) => s.language);
	const setLanguage = useI18nStore((s) => s.setLanguage);
	const contextManagerMode = useSettingsStore((s) => s.contextManagerMode);
	const setContextManagerMode = useSettingsStore((s) => s.setContextManagerMode);
	const channelWatchEnabled = useSettingsStore((s) => s.channelWatchEnabled);
	const setChannelWatchEnabled = useSettingsStore((s) => s.setChannelWatchEnabled);
	const browserControl = useUiPreferencesStore((s) => s.browserControl);
	const setBrowserControl = useUiPreferencesStore((s) => s.setBrowserControl);
	const TABS: { id: GeneralSettingsTab; label: string }[] = [
		{ id: "general", label: t("settings.tabGeneral") },
		...APPEARANCE_TABS.map((d) => ({ id: d.id as GeneralSettingsTab, label: t(d.labelKey) })),
		{ id: "web", label: t("settings.category.web") },
	];
	return (
		<div className="flex flex-col gap-6">
			<div className="flex gap-1 border-b border-border">
				{TABS.map(({ id, label }) => (
					<button
						key={id}
						type="button"
						className={`px-2.5 py-1.5 text-[12px] transition-colors ${tab === id ? "border-b-2 border-ink text-ink" : "text-ink-faint hover:text-ink"}`}
						onClick={() => setTab(id)}
					>
						{label}
					</button>
				))}
			</div>
			{tab === "web" ? (
				<WebAccessPanel />
			) : tab !== "general" ? (
				<AppearancePanel tab={tab} />
			) : (
				<>
					<div>
						<h3 className="text-[13px] font-medium text-ink">{t("settings.language")}</h3>
						<p className="mt-0.5 text-[11px] text-ink-faint">{t("settings.languageHint")}</p>
						<div className="mt-2 flex gap-2">
							{LANGUAGE_MODES.map((mode) => (
								<button
									key={mode}
									type="button"
									className={`rounded-lg border px-3 py-1.5 text-[13px] transition-colors ${
										language === mode
											? "border-ink bg-ink text-on-ink"
											: "border-border text-ink-2 hover:border-border-strong hover:bg-hover"
									}`}
									onClick={() => setLanguage(mode)}
								>
									{t(`lang.${mode}`)}
								</button>
							))}
						</div>
					</div>
					<div>
						<div className="flex items-center justify-between gap-4">
							<h3 className="text-[13px] font-medium text-ink">{t("settings.contextManager")}</h3>
							<div className="flex gap-2">
								{CONTEXT_MANAGER_MODES.map((mode) => (
									<button
										key={mode}
										type="button"
										disabled={contextManagerMode === null}
										className={`rounded-lg border px-3 py-1.5 text-[13px] transition-colors disabled:opacity-50 ${
											contextManagerMode === mode
												? "border-ink bg-ink text-on-ink"
												: "border-border text-ink-2 hover:border-border-strong hover:bg-hover"
										}`}
										onClick={() => void setContextManagerMode(mode)}
									>
										{t(`settings.contextManagerMode.${mode}`)}
									</button>
								))}
							</div>
						</div>
						<p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
							{contextManagerMode ? t(`settings.contextManagerHint.${contextManagerMode}`) : ""}
						</p>
					</div>
					<div>
						<div className="flex items-center justify-between gap-4">
							<h3 className="text-[13px] font-medium text-ink">{t("settings.channelWatch")}</h3>
							<Switch
								checked={channelWatchEnabled === true}
								disabled={channelWatchEnabled === null}
								onCheckedChange={(enabled) => {
									if (enabled) pushToast("info", "toast.channelWatchNewSession");
									void setChannelWatchEnabled(enabled);
								}}
							/>
						</div>
						<p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
							{t("settings.channelWatchHint")}
						</p>
					</div>
					<div>
						<div className="flex items-center justify-between gap-4">
							<h3 className="text-[13px] font-medium text-ink">{t("settings.browserControl")}</h3>
							<Switch checked={browserControl} onCheckedChange={setBrowserControl} />
						</div>
						<p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
							{t("settings.browserControlHint")}
						</p>
					</div>
				</>
			)}
		</div>
	);
}
