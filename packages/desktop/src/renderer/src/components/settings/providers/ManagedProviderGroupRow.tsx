import type { ProviderInfo, ProviderTestResult } from "@tcode/shared";
import { useState } from "react";
import { useT } from "../../../i18n";
import { useSettingsStore } from "../../../stores/settings";
import { ExpandArrowIcon, TestIcon } from "../../icons";
import { Switch } from "../../ui/Switch";
import { Tooltip } from "../../ui/Tooltip";
import { IconAction } from "./ProviderRow";

const EMPTY_MODEL_IDS: string[] = [];

function endpointLabel(baseUrl: string | undefined): string {
	if (!baseUrl) return "";
	try {
		return new URL(baseUrl).host;
	} catch {
		return baseUrl;
	}
}

export function ManagedProviderGroupRow({ providers }: { providers: ProviderInfo[] }) {
	const t = useT();
	const test = useSettingsStore((s) => s.test);
	const testResults = useSettingsStore((s) => s.testResults);
	const hiddenModels = useSettingsStore((s) => s.modelPrefs?.hiddenModels);
	const setModelHidden = useSettingsStore((s) => s.setModelHidden);
	const setModelsHidden = useSettingsStore((s) => s.setModelsHidden);
	const [modelsOpen, setModelsOpen] = useState(false);
	const name = providers[0]?.name ?? "";

	const rows = providers.flatMap((provider) => provider.models.map((model) => ({ provider, model })));
	const configured = providers.every((provider) => provider.configured);
	const hiddenCount = rows.filter(({ provider, model }) =>
		(hiddenModels?.[provider.id] ?? EMPTY_MODEL_IDS).includes(model.id),
	).length;
	const allVisible = hiddenCount === 0;
	const allHidden = hiddenCount > 0 && hiddenCount === rows.length;
	const mixed = !allVisible && !allHidden;

	const results = providers
		.map((provider) => testResults[provider.id])
		.filter((result): result is ProviderTestResult => !!result && result !== "testing");
	const testing = providers.some((provider) => testResults[provider.id] === "testing");
	const groupResult = testing
		? "testing"
		: results.length === providers.length
			? (results.find((result) => !result.ok) ?? results[0])
			: undefined;

	const toggleAll = () => {
		const nextHidden = !allHidden;
		for (const provider of providers) {
			void setModelsHidden(
				provider.id,
				provider.models.map((model) => model.id),
				nextHidden,
			);
		}
	};

	const runTest = () => {
		for (const provider of providers) void test(provider.id);
	};

	return (
		<li className="py-2.5">
			<div className="flex items-center gap-1">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5">
						<span className="truncate text-[13px] font-medium text-ink">{name}</span>
						<span className="rounded bg-hover px-1.5 py-0.5 text-[10px] text-ink-dim">
							{t("settings.providers.managed")}
						</span>
					</div>
					<div className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-faint">
						<button
							type="button"
							className="flex items-center gap-1 rounded hover:text-ink"
							onClick={() => setModelsOpen((open) => !open)}
							aria-expanded={modelsOpen}
						>
							{t("settings.providers.modelCount", { count: rows.length })}
							<ExpandArrowIcon className={`transition-transform ${modelsOpen ? "rotate-90" : ""}`} />
						</button>
					</div>
				</div>
				<span
					className={`mr-1 shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
						configured ? "bg-emerald-50 text-emerald-600" : "bg-hover text-ink-faint"
					}`}
				>
					{configured ? t("settings.providers.configured") : t("settings.providers.unconfigured")}
				</span>
				{configured && (
					<IconAction label={t("settings.providers.test")} disabled={testing} onClick={runTest}>
						{testing ? (
							<span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
						) : (
							<TestIcon />
						)}
					</IconAction>
				)}
				<Tooltip
					label={
						allHidden
							? t("settings.providers.showAllModels", { name })
							: t("settings.providers.hideAllModels", { name })
					}
					align="end"
				>
					<Switch
						checked={allVisible}
						indeterminate={mixed}
						disabled={rows.length === 0}
						onCheckedChange={toggleAll}
						aria-label={
							allHidden
								? t("settings.providers.showAllModels", { name })
								: t("settings.providers.hideAllModels", { name })
						}
					/>
				</Tooltip>
			</div>
			{groupResult && groupResult !== "testing" && (
				<p
					className={`mt-1.5 rounded-lg px-2.5 py-1.5 text-[11px] ${
						groupResult.ok ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
					}`}
				>
					{groupResult.ok
						? t("settings.providers.testOk", { modelId: groupResult.modelId ?? "" })
						: t("settings.providers.testFailed", { error: groupResult.error ?? "" })}
				</p>
			)}
			{modelsOpen && rows.length > 0 && (
				<div className="mt-2 rounded-lg bg-hover/60 px-2.5 py-2">
					<p className="mb-1 text-[10px] font-medium text-ink-faint">
						{t("settings.providers.modelVisibility")}
					</p>
					<ul className="space-y-0.5">
						{rows.map(({ provider, model }) => {
							const visible = !(hiddenModels?.[provider.id] ?? EMPTY_MODEL_IDS).includes(model.id);
							return (
								<li key={`${provider.id}/${model.id}`}>
									<div className="flex items-center gap-2 rounded px-1 py-1 text-[11px] text-ink-dim hover:bg-surface">
										<span className="min-w-0 flex-1 truncate">{model.name}</span>
										<span className="shrink-0 text-[10px] text-ink-faint">
											{endpointLabel(provider.baseUrl)}
										</span>
										<Switch
											checked={visible}
											onCheckedChange={(nextVisible) =>
												void setModelHidden(provider.id, model.id, !nextVisible)
											}
										/>
									</div>
								</li>
							);
						})}
					</ul>
				</div>
			)}
		</li>
	);
}
