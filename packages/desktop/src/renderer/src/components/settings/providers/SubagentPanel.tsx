import { isSubagentPackage, type SubagentInfo } from "@tcode/shared";
import { useEffect, useState } from "react";
import { type MessageKey, useT } from "../../../i18n";
import { errText } from "../../../lib/error-text";
import { useCatalogStore } from "../../../stores/catalog";
import { useSessionsStore } from "../../../stores/sessions";
import { useSettingsStore } from "../../../stores/settings";
import { useToastsStore } from "../../../stores/toasts";
import { Button } from "../../ui/Button";
import { Switch } from "../../ui/Switch";
import { AssistantDialog } from "./AssistantDialog";

function subagentPackageNames(packages: { source: string }[] | null): string[] {
	return [
		...new Set(
			(packages ?? [])
				.map((pkg) => pkg.source.replace(/^npm:/, ""))
				.filter((name) => isSubagentPackage({ name, description: "" })),
		),
	];
}

function SourceBadge({ source }: { source: SubagentInfo["source"] }) {
	const t = useT();
	const builtin = source === "builtin";
	return (
		<span
			className={
				"shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium " +
				(builtin ? "bg-accent/10 text-accent" : "bg-hover text-ink-2")
			}
		>
			{t(builtin ? "settings.models.assistantBuiltin" : "settings.models.assistantUser")}
		</span>
	);
}

export function SubagentPanel() {
	const t = useT();
	const loading = useSettingsStore((s) => s.loading);
	const subagents = useSettingsStore((s) => s.subagents);
	const prefs = useSettingsStore((s) => s.modelPrefs);
	const setSubagentPreferBuiltin = useSettingsStore((s) => s.setSubagentPreferBuiltin);
	const setMainAgentPrompt = useSettingsStore((s) => s.setMainAgentPrompt);
	const setMainAgentName = useSettingsStore((s) => s.setMainAgentName);
	const models = useSessionsStore((s) => s.models);
	const configuredPackages = useCatalogStore((s) => s.configuredPackages);
	const refreshConfiguredPackages = useCatalogStore((s) => s.refreshConfiguredPackages);
	const [dialog, setDialog] = useState<{ agent: SubagentInfo | null } | null>(null);

	const [mainText, setMainText] = useState("");
	const [mainName, setMainName] = useState("");
	const [mainSaving, setMainSaving] = useState(false);

	useEffect(() => {
		if (configuredPackages === null) void refreshConfiguredPackages();
	}, [configuredPackages, refreshConfiguredPackages]);

	useEffect(() => {
		setMainText(prefs?.mainAgentPrompt ?? "");
		setMainName(prefs?.mainAgentName ?? "");
	}, [prefs?.mainAgentPrompt, prefs?.mainAgentName]);

	if (loading && prefs === null) {
		return <p className="py-8 text-center text-[13px] text-ink-faint">{t("settings.loading")}</p>;
	}

	const preferBuiltin = prefs?.subagentPreferBuiltin !== false;
	const conflicts = subagentPackageNames(configuredPackages);

	const modelLabel = (agentName: string) => {
		const ref = prefs?.subagentModels[agentName];
		if (!ref) return t("settings.models.inherit");
		const found = models.find((model) => model.provider + "/" + model.id === ref);
		return found ? found.providerName + " · " + found.label : ref;
	};
	const thinkingLabel = (level: string) => t(("thinkingLevels." + level) as MessageKey);

	const saveMainAgent = async () => {
		if (mainSaving) return;
		setMainSaving(true);
		try {
			await setMainAgentName(mainName.trim() ? mainName : null);
			await setMainAgentPrompt(mainText.trim() ? mainText : null);
			useToastsStore.getState().push("info", "settings.models.mainAgentSaved");
		} catch (error) {
			useToastsStore.getState().push("error", "settings.models.mainAgentSaveFailed", errText(error));
		} finally {
			setMainSaving(false);
		}
	};

	return (
		<div>
			<div className="mb-5 border-b border-border pb-4">
				<div className="flex items-center justify-between gap-4">
					<input
						type="text"
						className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-[13px] font-medium text-ink outline-none transition-colors hover:border-border focus:border-ink-faint"
						value={mainName}
						onChange={(e) => setMainName(e.target.value)}
						placeholder={t("settings.models.mainAgentTitle")}
						aria-label={t("settings.models.mainAgentName")}
						spellCheck={false}
					/>
					<Button size="sm" variant="primary" disabled={mainSaving} onClick={() => void saveMainAgent()}>
						{t("common.save")}
					</Button>
				</div>
				<p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
					{t("settings.models.mainAgentHint")}
				</p>
				<textarea
					className="mt-2 h-24 w-full resize-none rounded-lg border border-border px-2.5 py-1.5 font-mono text-[12px] outline-none focus:border-ink-faint"
					value={mainText}
					onChange={(e) => setMainText(e.target.value)}
					placeholder={t("settings.models.mainAgentPromptPlaceholder")}
					spellCheck={false}
				/>
			</div>
			<div className="mb-4">
				<div className="flex items-center justify-between gap-4">
					<h3 className="text-[13px] font-medium text-ink">{t("settings.models.subagentExecutorTitle")}</h3>
					<Switch
						checked={preferBuiltin}
						disabled={prefs === null}
						onCheckedChange={(enabled) => void setSubagentPreferBuiltin(enabled)}
					/>
				</div>
				<p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
					{t("settings.models.subagentExecutorHint")}
				</p>
				{preferBuiltin && conflicts.length > 0 && (
					<p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
						{t("settings.models.subagentExecutorConflictHint", { names: conflicts.join(", ") })}
					</p>
				)}
			</div>

			<div className="flex items-center justify-between gap-4">
				<h3 className="text-[13px] font-medium text-ink">{t("settings.models.assistantsTitle")}</h3>
				<Button size="sm" variant="primary" onClick={() => setDialog({ agent: null })}>
					{t("settings.models.assistantAdd")}
				</Button>
			</div>
			<p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
				{t("settings.models.assistantRosterHint")}
			</p>
			{subagents.length === 0 ? (
				<p className="py-4 text-center text-[13px] text-ink-faint">{t("settings.models.assistantEmpty")}</p>
			) : (
				<ul className="mt-2 divide-y divide-border">
					{subagents.map((agent) => {
						const thinking = prefs?.subagentThinking?.[agent.name];
						return (
							<li key={agent.name}>
								<button
									type="button"
									className="w-full rounded-lg py-2.5 text-left transition-colors hover:bg-hover/40"
									onClick={() => setDialog({ agent })}
								>
									<div className="flex items-center gap-2">
										<span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
											{agent.name}
										</span>
										<SourceBadge source={agent.source} />
									</div>
									{agent.description && (
										<p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-ink-dim">
											{agent.description}
										</p>
									)}
									<p className="mt-1 truncate text-[11px] text-ink-faint">
										{t("settings.models.assistantTools")}:{" "}
										{agent.tools.length > 0 ? agent.tools.join(", ") : t("settings.models.assistantNoTools")}
										{" · "}
										{t("settings.models.assistantModel")}: {modelLabel(agent.name)}
										{thinking
											? " · " + t("settings.models.assistantThinking") + ": " + thinkingLabel(thinking)
											: ""}
									</p>
									{agent.thinkingWarning && (
										<p className="mt-0.5 text-[11px] text-ink-faint">
											{t("settings.models.subagentThinkingInvalid", { value: agent.thinkingWarning })}
										</p>
									)}
								</button>
							</li>
						);
					})}
				</ul>
			)}
			{dialog && <AssistantDialog agent={dialog.agent} onClose={() => setDialog(null)} />}
		</div>
	);
}
