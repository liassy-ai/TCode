import type { AppInfo, ComponentLicense } from "@tcode/shared";
import { useEffect, useState } from "react";
import { getPi } from "../../api";
import appIcon from "../../assets/app-icon.png";
import { chromeLanguage, useI18nStore, useT } from "../../i18n";

const BUNDLED_COMPONENTS: Array<{ name: string; license: string; author: string }> = [
	{ name: "Pi SDK", license: "MIT", author: "Mario Zechner" },
	{ name: "Electron", license: "MIT", author: "Electron Community" },
];

export function AboutPanel() {
	const t = useT();
	const lang = chromeLanguage(useI18nStore((s) => s.language));
	const [info, setInfo] = useState<AppInfo | null>(null);
	const [runtimeLicenses, setRuntimeLicenses] = useState<ComponentLicense[]>([]);

	useEffect(() => {
		let cancelled = false;
		void getPi()
			.getAppInfo()
			.then((appInfo) => {
				if (!cancelled) setInfo(appInfo);
			})
			.catch(() => {
				if (!cancelled) setInfo(null);
			});
		void getPi()
			.componentLicensesGet()
			.then((items) => {
				if (!cancelled) setRuntimeLicenses(Array.isArray(items) ? items : []);
			})
			.catch(() => {
				if (!cancelled) setRuntimeLicenses([]);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<div className="flex min-h-full flex-col items-center justify-center gap-1.5 py-10 text-center">
			<img src={appIcon} alt="TCode" className="h-12 w-12 rounded-xl" />
			<p className="mt-2 text-[14px] font-semibold text-ink">{info?.name ?? "TCode"}</p>
			<p className="text-[11px] text-ink-faint">{t("settings.about.poweredBy")}</p>
			<p className="mt-2 font-mono text-[12px] text-ink-dim">
				{t("settings.about.version")} {info?.version ?? "…"}
			</p>

			<div className="mt-6 w-full max-w-[460px] border-t border-border pt-3 text-left">
				<p className="text-[11px] font-semibold text-ink-dim">{t("settings.about.licenseTitle")}</p>
				<p className="mt-1 text-[11px] text-ink-faint">{t("settings.about.selfLicense")}</p>
				<ul className="mt-2 flex flex-col gap-1">
					{[...BUNDLED_COMPONENTS, ...runtimeLicenses].map((c) => {
						const desc =
							"description" in c
								? lang === "en"
									? (c.descriptionEn ?? c.description)
									: (c.description ?? c.descriptionEn)
								: undefined;
						const right = desc
							? c.author
								? `${desc} · ${c.author}`
								: desc
							: c.author
								? `${c.license} · ${c.author}`
								: c.license;
						return (
							<li key={c.name} className="flex items-baseline justify-between gap-3 text-[11px]">
								<span className="text-ink-dim">{c.name}</span>
								<span className="text-ink-faint">{right}</span>
							</li>
						);
					})}
				</ul>
				<p className="mt-2 text-[11px] text-ink-faint">{t("settings.about.author")}</p>
			</div>
		</div>
	);
}
