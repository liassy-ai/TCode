import {
	FEATURE_GATED_SKILLS,
	LANGUAGE_GATED_SKILLS,
	type LoadedSkill,
	type ResourceScope,
	type SkillTier,
	skillDisplayName,
} from "@tcode/shared";
import { useState } from "react";
import { chatLanguage, useI18nStore, useT } from "../../i18n";
import { useSettingsStore } from "../../stores/settings";
import { Button } from "../ui/Button";
import { Switch } from "../ui/Switch";
import { AddSkillDialog } from "./AddSkillDialog";
import { SkillDetailDialog } from "./SkillDetailDialog";

function ScopeBadge({ scope, tier }: { scope: ResourceScope; tier: SkillTier }) {
	const t = useT();
	if (tier === "core" || tier === "system") {
		return (
			<span
				className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-accent ${
					tier === "core" ? "bg-accent/15" : "bg-accent/10"
				}`}
			>
				{t(tier === "core" ? "settings.skills.scopeCore" : "settings.skills.scopeSystem")}
			</span>
		);
	}
	const key =
		scope === "project"
			? "settings.skills.scopeProject"
			: scope === "temporary"
				? "settings.skills.scopeTemporary"
				: "settings.skills.scopeUser";
	return (
		<span
			className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
				scope === "project" ? "bg-accent/10 text-accent" : "bg-hover text-ink-2"
			}`}
		>
			{t(key)}
		</span>
	);
}

function SkillRow({
	skill,
	frontmatterDisabled,
	onOpen,
}: {
	skill: LoadedSkill;
	frontmatterDisabled: boolean;
	onOpen: (skill: LoadedSkill) => void;
}) {
	const t = useT();
	const setSkillModelInvocationDisabled = useSettingsStore((s) => s.setSkillModelInvocationDisabled);

	const badge = !skill.disableModelInvocation
		? null
		: skill.defaultDisabled
			? t("settings.skills.defaultDisabled")
			: t("settings.skills.manualOnly");

	const gatedFeature = FEATURE_GATED_SKILLS[skill.name];

	const tier = skill.tier ?? "user";
	const coreLocked = tier === "core";
	return (
		<li className="rounded-lg py-2.5 transition-colors hover:bg-hover/40">
			<div className="flex items-start gap-2">
				<button
					type="button"
					className="min-w-0 flex-1 text-left"
					onClick={() => onOpen(skill)}
					title={t("settings.skills.openDetail")}
				>
					<div className="flex items-center gap-2">
						<span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
							{skillDisplayName(skill.name)}
						</span>
						{badge && (
							<span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-ink-faint">{badge}</span>
						)}
						<ScopeBadge scope={skill.scope} tier={tier} />
					</div>
					{skill.description && (
						<p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-ink-dim">
							{skill.description}
						</p>
					)}

					{skill.spaceDefaults && skill.spaceDefaults.daily !== skill.spaceDefaults.project && (
						<p className="mt-0.5 text-[11px] text-ink-faint">
							{t("settings.skills.spaceDefaultsHint", {
								daily: t(
									skill.spaceDefaults.daily
										? "settings.skills.spaceDefaultOn"
										: "settings.skills.spaceDefaultOff",
								),
								project: t(
									skill.spaceDefaults.project
										? "settings.skills.spaceDefaultOn"
										: "settings.skills.spaceDefaultOff",
								),
							})}
						</p>
					)}
					<p className="mt-1 truncate font-mono text-[10px] text-ink-faint">{skill.path}</p>
				</button>

				<Switch
					checked={!skill.disableModelInvocation}
					disabled={frontmatterDisabled || Boolean(gatedFeature) || coreLocked}
					onCheckedChange={(checked) => void setSkillModelInvocationDisabled(skill.name, !checked)}
					aria-label={t("settings.skills.toggleAria", { name: skillDisplayName(skill.name) })}
					title={
						frontmatterDisabled
							? t("settings.skills.toggleFrontmatterLocked")
							: gatedFeature
								? t("settings.skills.toggleFeatureGated", {
										feature: t(
											gatedFeature === "browserControl"
												? "settings.browserControl"
												: gatedFeature === "crossSessionCollab"
													? "settings.channelWatch"
													: "settings.uiPlugins.title",
										),
									})
								: coreLocked
									? t("settings.skills.toggleCoreLocked")
									: t("settings.skills.toggleHint")
					}
				/>
			</div>
		</li>
	);
}

export function SkillsPanel() {
	const t = useT();
	const skills = useSettingsStore((s) => s.skills);
	const diagnostics = useSettingsStore((s) => s.skillDiagnostics);
	const skillPrefs = useSettingsStore((s) => s.skillPrefs);
	const userDisabled = new Set(skillPrefs?.modelInvocationDisabled ?? []);
	const [adding, setAdding] = useState(false);
	const [detail, setDetail] = useState<LoadedSkill | null>(null);

	const lang = chatLanguage(useI18nStore((s) => s.language));
	const visible = skills?.filter((s) => (LANGUAGE_GATED_SKILLS[s.name] ?? lang) === lang) ?? null;

	const header = (
		<div className="flex items-center justify-between">
			<h3 className="text-[13px] font-medium text-ink">{t("settings.skills.title")}</h3>
			<Button size="sm" variant="primary" onClick={() => setAdding(true)}>
				{t("settings.skills.add")}
			</Button>
		</div>
	);

	if (visible === null) {
		return (
			<div>
				{header}
				<p className="py-8 text-center text-[13px] text-ink-faint">{t("settings.skills.loading")}</p>
			</div>
		);
	}
	return (
		<div>
			{header}
			<p className="mt-1 text-[11px] leading-relaxed text-ink-faint">{t("settings.skills.tiersHint")}</p>
			{visible.length === 0 ? (
				<p className="py-8 text-center text-[13px] text-ink-faint">{t("settings.skills.empty")}</p>
			) : (
				<ul className="mt-3 divide-y divide-border">
					{visible.map((skill) => (
						<SkillRow
							key={skill.path}
							skill={skill}
							frontmatterDisabled={
								skill.disableModelInvocation && !userDisabled.has(skill.name) && !skill.defaultDisabled
							}
							onOpen={setDetail}
						/>
					))}
				</ul>
			)}
			{diagnostics.length > 0 && (
				<div className="mt-4">
					<p className="text-[11px] font-medium text-ink-2">{t("settings.skills.diagnostics")}</p>
					<ul className="mt-1 space-y-1">
						{diagnostics.map((d) => (
							<li key={d.path ?? d.message} className="text-[11px] leading-relaxed text-ink-dim">
								<span className={d.type === "error" ? "text-red-500" : "text-amber-500"}>{d.type}</span>
								{" — "}
								{d.message}
							</li>
						))}
					</ul>
				</div>
			)}
			{adding && <AddSkillDialog onDone={() => setAdding(false)} />}
			{detail && <SkillDetailDialog skill={detail} onClose={() => setDetail(null)} />}
		</div>
	);
}
