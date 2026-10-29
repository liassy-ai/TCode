import type { ComponentType } from "react";
import { useUiPluginsStore } from "../stores/ui-plugins";
import { PluginBoundary } from "./PluginBoundary";
import { useUiPluginRegistry } from "./registry";
import type { SlotName, SlotPropsMap } from "./slots";

export function Slot<N extends SlotName>({
	name,
	props,
	fallback: Fallback,
}: {
	name: N;
	props: SlotPropsMap[N];
	fallback: ComponentType<SlotPropsMap[N]>;
}) {
	const override = useUiPluginRegistry((s) => s.overrides[name]);
	const nonce = useUiPluginRegistry((s) => (override ? s.loadNonces[override.pluginName] : 0));

	const masterOn = useUiPluginsStore((s) => s.config.enabled);
	if (masterOn && override) {
		const PluginComponent = override.component as ComponentType<SlotPropsMap[N]>;
		return (
			<PluginBoundary
				key={`${override.pluginName}:${nonce}`}
				pluginName={override.pluginName}
				label={name}
				fallback={<Fallback {...props} />}
			>
				<PluginComponent {...props} />
			</PluginBoundary>
		);
	}
	return <Fallback {...props} />;
}
