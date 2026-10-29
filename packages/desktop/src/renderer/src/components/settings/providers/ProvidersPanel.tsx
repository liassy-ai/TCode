import type { ProviderInfo } from "@tcode/shared";
import { useMemo, useState } from "react";
import { useT } from "../../../i18n";
import { useSettingsStore } from "../../../stores/settings";
import { SkillsPanel } from "../SkillsPanel";
import { CustomProviderForm } from "./CustomProviderForm";
import { LoginDialog } from "./LoginDialog";
import { ManagedProviderGroupRow } from "./ManagedProviderGroupRow";
import { ProviderRow } from "./ProviderRow";
import { SubagentPanel } from "./SubagentPanel";

type ModelSettingsTab = "providers" | "subagents" | "skills";

export function ProvidersPanel() {
	const t = useT();
	const [tab, setTab] = useState<ModelSettingsTab>("providers");
	const providers = useSettingsStore((s) => s.providers);
	const loading = useSettingsStore((s) => s.loading);
	const error = useSettingsStore((s) => s.error);

	const configured = useMemo(
		() => providers.filter((provider) => provider.configured || provider.custom || provider.managed),
		[providers],
	);

	return (
		<div>
			<div className="mb-3 flex gap-1 border-b border-border">
				{(["providers", "subagents", "skills"] as const).map((id) => (
					<button
						key={id}
						type="button"
						className={`px-2.5 py-1.5 text-[12px] transition-colors ${
							tab === id ? "border-b-2 border-ink text-ink" : "text-ink-faint hover:text-ink"
						}`}
						onClick={() => setTab(id)}
					>
						{t(`settings.models.${id}`)}
					</button>
				))}
			</div>
			{tab === "subagents" ? (
				<SubagentPanel />
			) : tab === "skills" ? (
				<SkillsPanel />
			) : (
				<>
					{error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-600">{error}</p>}
					{loading && providers.length === 0 ? (
						<p className="py-8 text-center text-[13px] text-ink-faint">{t("settings.loading")}</p>
					) : (
						<ProviderList providers={configured} />
					)}
					<CustomProviderForm />
					<LoginDialog />
				</>
			)}
		</div>
	);
}

function ProviderList({ providers }: { providers: ProviderInfo[] }) {
	const t = useT();
	if (providers.length === 0) {
		return (
			<p className="py-4 text-center text-[13px] text-ink-faint">{t("settings.providers.noneConfigured")}</p>
		);
	}
	const groups = new Map<string, ProviderInfo[]>();
	for (const provider of providers) {
		const key = provider.managed ? `managed:${provider.name || provider.id}` : `id:${provider.id}`;
		const group = groups.get(key);
		if (group) group.push(provider);
		else groups.set(key, [provider]);
	}

	return (
		<ul className="divide-y divide-border">
			{Array.from(groups.entries()).map(([key, group]) => {
				const first = group[0];
				if (!first) return null;
				return group.length > 1 ? (
					<ManagedProviderGroupRow key={key} providers={group} />
				) : (
					<ProviderRow key={first.id} provider={first} />
				);
			})}
		</ul>
	);
}
