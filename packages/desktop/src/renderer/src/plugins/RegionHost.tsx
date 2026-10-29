import type { UiPluginAnchor } from "@tcode/shared";
import type { ComponentType } from "react";
import { useUiPluginsStore } from "../stores/ui-plugins";
import { PluginBoundary } from "./PluginBoundary";
import { type Contribution, useUiPluginRegistry } from "./registry";
import { type RegionName, UI_REGIONS } from "./slots";

export const EMPTY_CONTRIBUTIONS: Contribution[] = [];

const OVERLAY_ANCHOR_CLASSES: Record<UiPluginAnchor, string> = {
	"top-left": "items-start justify-start",
	"top-center": "items-start justify-center",
	"top-right": "items-start justify-end",
	"center-left": "items-center justify-start",
	center: "items-center justify-center",
	"center-right": "items-center justify-end",
	"bottom-left": "items-end justify-start",
	"bottom-center": "items-end justify-center",
	"bottom-right": "items-end justify-end",
};

const CORNER_POS_CLASSES: Partial<Record<RegionName, string>> = {
	[UI_REGIONS.CornerTopLeft]: "top-2 left-4",
	[UI_REGIONS.CornerTopRight]: "top-2 right-4 pt-12",
	[UI_REGIONS.CornerBottomLeft]: "bottom-2 left-4",
	[UI_REGIONS.CornerBottomRight]: "bottom-2 right-4",
};

export function RegionHost({ region }: { region: RegionName }) {
	const list = useUiPluginRegistry((s) => s.contributions[region]) ?? EMPTY_CONTRIBUTIONS;

	const nonces = useUiPluginRegistry((s) => s.loadNonces);

	const masterOn = useUiPluginsStore((s) => s.config.enabled);
	if (!masterOn || list.length === 0) return null;

	const renderContribution = (c: Contribution) => {
		const Comp = c.component as ComponentType<Record<string, never>>;
		return (
			<div key={`${c.pluginName}:${c.id}:${nonces[c.pluginName] ?? 0}`} data-plugin={c.pluginName}>
				<PluginBoundary pluginName={c.pluginName} label={`region ${region}`}>
					<Comp />
				</PluginBoundary>
			</div>
		);
	};

	switch (region) {
		case UI_REGIONS.AppBackground:
			return (
				<div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
					{list.map(renderContribution)}
				</div>
			);
		case UI_REGIONS.AppOverlay:
			return (
				<>
					{list.map((c) => (
						<div
							key={`${c.pluginName}:${c.id}:${nonces[c.pluginName] ?? 0}`}
							data-plugin={c.pluginName}
							className={`pointer-events-none fixed inset-0 z-20 flex ${OVERLAY_ANCHOR_CLASSES[c.anchor ?? "bottom-right"]}`}
						>
							<PluginBoundary pluginName={c.pluginName} label={`region ${region}`}>
								<c.component />
							</PluginBoundary>
						</div>
					))}
				</>
			);
		case UI_REGIONS.CornerTopLeft:
		case UI_REGIONS.CornerTopRight:
		case UI_REGIONS.CornerBottomLeft:
		case UI_REGIONS.CornerBottomRight:
			return (
				<div
					className={`pointer-events-none absolute z-20 flex flex-col gap-2 ${CORNER_POS_CLASSES[region]}`}
				>
					{list.map(renderContribution)}
				</div>
			);
		case UI_REGIONS.ComposerFooter:
			return <>{list.map(renderContribution)}</>;
		default:
			return null;
	}
}
